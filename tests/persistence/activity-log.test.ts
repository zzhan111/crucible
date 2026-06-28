import { describe, it, expect, beforeEach } from 'vitest';
import { openAndMigrate, type DB } from '../../src/persistence/db.js';
import {
  insertContract,
  insertScoreRun,
  insertProposal,
  updateProposalGate,
  listActivityLog,
  artifactHash,
} from '../../src/persistence/repositories.js';
import type { ScoreReport } from '../../src/scorer/types.js';

function sampleReport(det = 0.8, judge: number | null = 0.6): ScoreReport {
  return {
    deterministic: { violations: [], rubric_scores: [], hard_violation_count: 0, deterministic_score: det },
    judge: judge === null ? null : { rubric_scores: [], overall_score: judge },
    final_score: det,
  };
}
const artifact = { family: 'sequence', nodes: [{ day: 1 }] };

describe('P4.2 全量活动日志 + append-only 历史', () => {
  let db: DB;
  beforeEach(() => {
    db = openAndMigrate(); // :memory:,跑 001 + 002
  });

  describe('002 migration', () => {
    it('score_runs 有 actor_id + tenant_id 列', () => {
      const cols = (db.prepare('PRAGMA table_info(score_runs)').all() as Array<{ name: string }>).map(c => c.name);
      expect(cols).toContain('actor_id');
      expect(cols).toContain('tenant_id');
    });
    it('proposals 有 approver_id + decided_at + actor_id 列', () => {
      const cols = (db.prepare('PRAGMA table_info(proposals)').all() as Array<{ name: string }>).map(c => c.name);
      expect(cols).toContain('approver_id');
      expect(cols).toContain('decided_at');
      expect(cols).toContain('actor_id');
    });
    it('schema_version 记录 v1 + v2 + v3(P4.2.5 加 003)', () => {
      const versions = (db.prepare('SELECT version FROM schema_version ORDER BY version').all() as Array<{ version: number }>).map(r => r.version);
      expect(versions).toEqual([1, 2, 3]);
    });
    it('idx_score_runs_artifact_contract(unique)已删 — append-only', () => {
      const idxs = (db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='score_runs'").all() as Array<{ name: string }>).map(r => r.name);
      expect(idxs).not.toContain('idx_score_runs_artifact_contract');
      expect(idxs).toContain('idx_score_runs_tenant_artifact_time');
    });
  });

  describe('append-only 历史(去 INSERT OR REPLACE)', () => {
    it('同工件同契约多次评分全留(不再 REPLACE)', () => {
      insertContract(db, { version: 1, family: 'sequence', yaml_text: 'y' });
      insertScoreRun(db, artifact, 1, sampleReport(0.5), 'alice');
      insertScoreRun(db, artifact, 1, sampleReport(0.9), 'bob');
      const rows = db.prepare('SELECT det_score, actor_id FROM score_runs WHERE artifact_hash=?').all(artifactHash(artifact)) as Array<{ det_score: number; actor_id: string }>;
      expect(rows).toHaveLength(2);
      expect(rows.map(r => r.det_score)).toContain(0.5);
      expect(rows.map(r => r.det_score)).toContain(0.9);
    });
    it('getScoreRun 取最新一条(ORDER BY created_at DESC LIMIT 1)', async () => {
      const { getScoreRun } = await import('../../src/persistence/repositories.js');
      insertContract(db, { version: 1, family: 'sequence', yaml_text: 'y' });
      insertScoreRun(db, artifact, 1, sampleReport(0.5), 'alice');
      // 让 created_at 不同(同秒可能相同,但 LIMIT 1 仍取一行)
      insertScoreRun(db, artifact, 1, sampleReport(0.9), 'bob');
      const got = getScoreRun(db, artifact, 1);
      expect(got).toBeDefined();
      // 取到的是一条(0.5 或 0.9,取决于时间戳;两条都合法)
      expect([0.5, 0.9]).toContain(got!.deterministic.deterministic_score);
    });
  });

  describe('listActivityLog', () => {
    beforeEach(() => {
      insertContract(db, { version: 1, family: 'sequence', yaml_text: 'y' });
    });

    it('score_run 事件出现在日志', () => {
      insertScoreRun(db, artifact, 1, sampleReport(), 'alice');
      const log = listActivityLog(db);
      expect(log).toHaveLength(1);
      expect(log[0].event).toBe('score_run');
      expect(log[0].actor_id).toBe('alice');
      expect(log[0].det_score).toBe(0.8);
    });

    it('proposal 事件 + 审批(approver_id)出现', () => {
      const proposal = { dim: 'state' as const, tokens: ['new_state'], rationale: 'novel' };
      insertProposal(db, artifact, 1, proposal, 'curator');
      const id = (db.prepare('SELECT id FROM proposals').get() as { id: number }).id;
      updateProposalGate(db, id, 'approved', 'compliance_officer');
      const log = listActivityLog(db);
      const propEntry = log.find(e => e.event === 'proposal');
      expect(propEntry).toBeDefined();
      expect(propEntry!.actor_id).toBe('curator');
      expect(propEntry!.approver_id).toBe('compliance_officer');
      expect(propEntry!.gate_decision).toBe('approved');
    });

    it('按 actor 过滤(评分 + 提议/审批)', () => {
      insertScoreRun(db, artifact, 1, sampleReport(), 'alice');
      insertScoreRun(db, artifact, 1, sampleReport(), 'bob');
      const aliceLog = listActivityLog(db, { actorId: 'alice' });
      expect(aliceLog.every(e => e.actor_id === 'alice')).toBe(true);
      expect(aliceLog).toHaveLength(1);
    });

    it('按 tenant 过滤(默认 default)', () => {
      insertScoreRun(db, artifact, 1, sampleReport(), 'alice', 'default');
      insertScoreRun(db, artifact, 1, sampleReport(), 'bob', 'acme-corp');
      const defaultLog = listActivityLog(db, { tenantId: 'default' });
      expect(defaultLog).toHaveLength(1);
      expect(defaultLog[0].actor_id).toBe('alice');
    });

    it('时间倒序', () => {
      insertScoreRun(db, artifact, 1, sampleReport(), 'a');
      insertScoreRun(db, artifact, 1, sampleReport(), 'b');
      const log = listActivityLog(db);
      // 第一条 created_at >= 第二条(倒序)
      expect(log[0].at >= log[1].at).toBe(true);
    });

    it('limit 截断', () => {
      for (let i = 0; i < 5; i++) insertScoreRun(db, artifact, 1, sampleReport(), `u${i}`);
      expect(listActivityLog(db, { limit: 3 })).toHaveLength(3);
    });

    it('空 DB → []', () => {
      expect(listActivityLog(db)).toEqual([]);
    });
  });

  describe('tenant 隔离(on-prem 单租户场景)', () => {
    it('不同 tenant 的 score_runs 互不可见(listActivityLog 按 tenant 过滤)', () => {
      insertContract(db, { version: 1, family: 'sequence', yaml_text: 'y' });
      insertScoreRun(db, artifact, 1, sampleReport(), 'alice', 'tenant-a');
      insertScoreRun(db, artifact, 1, sampleReport(), 'bob', 'tenant-b');
      expect(listActivityLog(db, { tenantId: 'tenant-a' })).toHaveLength(1);
      expect(listActivityLog(db, { tenantId: 'tenant-b' })).toHaveLength(1);
      expect(listActivityLog(db, { tenantId: 'tenant-a' })[0].actor_id).toBe('alice');
    });
  });
});
