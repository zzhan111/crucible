import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { openAndMigrate, openAuditDB, type DB } from '../../src/persistence/db.js';
import { insertScoreRun, insertContract, artifactHash } from '../../src/persistence/repositories.js';
import {
  persistScoreRun,
  resolveContractVersion,
} from '../../src/persistence/sink.js';
import {
  listScoreRunsForArtifact,
  getArtifactAuditTrail,
} from '../../src/persistence/audit.js';
import type { Contract } from '../../src/contract/schema.js';
import type { ScoreReport } from '../../src/scorer/types.js';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

/** 构造一个带可选 metadata.version 的最小 Contract(绕过 zod,sink 不重新解析)。 */
function makeContract(version: number | undefined): Contract {
  const c = {
    artifact_family: 'sequence' as const,
    fields: [{ name: 'day', type: 'integer' as const, required: true }],
    hard_constraints: [{ id: 'continuity', type: 'declarative' as const, rule: 'adjacent link' }],
    rubric: [
      { dim: 'cost_fit', weight: 0.5, mode: 'deterministic' as const },
      { dim: 'source_trust', weight: 0.5, mode: 'deterministic' as const },
    ],
    calibration: { frozen_golden_set: 'golden/hk.jsonl', metric: 'kendall_tau' as const },
  };
  return (version === undefined ? c : { ...c, metadata: { version } }) as Contract;
}

function sampleScoreReport(detScore = 0.8, judgeScore: number | null = 0.6): ScoreReport {
  return {
    deterministic: {
      violations: [
        { constraint_id: 'continuity', severity: 'hard', message: 'gap at node 2', location: { node_index: 2 }, fix_hint: 'add transit' },
      ],
      rubric_scores: [
        { dim: 'cost_fit', score: 0.9, mode: 'deterministic', rationale: 'within budget' },
        { dim: 'source_trust', score: 0.4, mode: 'deterministic', rationale: '2/5 nodes sourced' },
      ],
      hard_violation_count: 1,
      deterministic_score: detScore,
    },
    judge: judgeScore === null ? null : { rubric_scores: [{ dim: 'routing', score: judgeScore, mode: 'judge', rationale: 'ok' }], overall_score: judgeScore },
    final_score: detScore * 0.6 + (judgeScore ?? 0) * 0.4,
  };
}

const sampleArtifact = { family: 'sequence', nodes: [{ day: 1, state: ['hotel'] }] };

describe('P4.1 审计轨迹:写接入 + 查询层', () => {
  let db: DB;
  beforeEach(() => {
    db = openAndMigrate();
  });

  describe('resolveContractVersion', () => {
    it('有 metadata.version → 返回该 number', () => {
      expect(resolveContractVersion(makeContract(3))).toBe(3);
    });
    it('无 metadata → 默认 1(不是 "v1")', () => {
      expect(resolveContractVersion(makeContract(undefined))).toBe(1);
    });
    it('<1 → 抛错(不静默写脏数据,FK 会爆)', () => {
      expect(() => resolveContractVersion(makeContract(0))).toThrow();
    });
    it('非整数 → 抛错', () => {
      expect(() => resolveContractVersion(makeContract(1.5 as unknown as number))).toThrow();
    });
  });

  describe('persistScoreRun', () => {
    it('落 contract + score_run,可经 getScoreRun 读回', () => {
      persistScoreRun(db, sampleArtifact, makeContract(1), sampleScoreReport());
      const got = getScoreRunBack(db, sampleArtifact, 1);
      expect(got).toBeDefined();
      expect(got!.deterministic.deterministic_score).toBe(0.8);
    });
    it('版本规范化:无 metadata 的契约落库为 version=1', () => {
      persistScoreRun(db, sampleArtifact, makeContract(undefined), sampleScoreReport());
      const rows = listScoreRunsForArtifact(db, sampleArtifact);
      expect(rows).toHaveLength(1);
      expect(rows[0].contract_version).toBe(1);
    });
    it('P4.2 append-only:同工件同契约重跑全留(审计可追溯重评分历史)', () => {
      // P3.5 用 INSERT OR REPLACE 只留最新;P4.2 改 append-only — 重评分全留,可追溯。
      const c = makeContract(1);
      persistScoreRun(db, sampleArtifact, c, sampleScoreReport(0.5));
      persistScoreRun(db, sampleArtifact, c, sampleScoreReport(0.9));
      const rows = listScoreRunsForArtifact(db, sampleArtifact);
      expect(rows).toHaveLength(2);
      // 两次评分都保留(同秒插入时 created_at 相同,顺序不保证 — 只验内容存在)
      expect(rows.map(r => r.det_score).sort()).toEqual([0.5, 0.9]);
    });
    it('不同契约版本各留一条(审计能看到演化)', () => {
      persistScoreRun(db, sampleArtifact, makeContract(1), sampleScoreReport(0.5));
      persistScoreRun(db, sampleArtifact, makeContract(2), sampleScoreReport(0.9));
      const rows = listScoreRunsForArtifact(db, sampleArtifact);
      expect(rows).toHaveLength(2);
      expect(rows.map(r => r.contract_version).sort()).toEqual([1, 2]);
    });
  });

  describe('listScoreRunsForArtifact', () => {
    it('空工件 → []', () => {
      expect(listScoreRunsForArtifact(db, { family: 'sequence', nodes: [] })).toEqual([]);
    });
    it('直接 insertScoreRun(不经 sink)也能查到(hash 语义一致)', () => {
      // FK 要求先有 contracts 行;直接 insertScoreRun 测试 hash 语义与 sink 一致
      insertContract(db, { version: 1, family: 'sequence', yaml_text: 'family: sequence' });
      insertScoreRun(db, sampleArtifact, 1, sampleScoreReport());
      const rows = listScoreRunsForArtifact(db, sampleArtifact);
      expect(rows).toHaveLength(1);
      expect(rows[0].contract_version).toBe(1);
    });
  });

  describe('getArtifactAuditTrail', () => {
    it('无记录 → undefined', () => {
      expect(getArtifactAuditTrail(db, sampleArtifact)).toBeUndefined();
    });
    it('组装:family/rubric_scores/violations/source_trust 抽取正确', () => {
      persistScoreRun(db, sampleArtifact, makeContract(1), sampleScoreReport(0.8, 0.6));
      const trail = getArtifactAuditTrail(db, sampleArtifact);
      expect(trail).toBeDefined();
      expect(trail!.artifact_hash).toBe(artifactHash(sampleArtifact));
      expect(trail!.runs).toHaveLength(1);
      const run = trail!.runs[0];
      expect(run.family).toBe('sequence');
      expect(run.contract_version).toBe(1);
      expect(run.det_score).toBe(0.8);
      expect(run.judge_score).toBe(0.6);
      expect(run.violations).toHaveLength(1);
      expect(run.violations[0].constraint_id).toBe('continuity');
      // rubric_scores = deterministic(2) + judge(1)
      expect(run.rubric_scores).toHaveLength(3);
      // source_trust 从 rubric_scores 抽出 = 0.4
      expect(run.source_trust).toBe(0.4);
      // P4.2: actor_id(SYSTEM_ACTOR 默认 system)
      expect(run.actor_id).toBe('system');
    });
    it('P4.2: 传 actor → trail 带 actor_id', () => {
      const actor = { id: 'analyst1', role: 'author' as const };
      persistScoreRun(db, sampleArtifact, makeContract(1), sampleScoreReport(0.8, 0.6), actor);
      const trail = getArtifactAuditTrail(db, sampleArtifact);
      expect(trail!.runs[0].actor_id).toBe('analyst1');
    });
    it('无 judge 时 judge_score=null,source_trust 仍可从 deterministic 抽出', () => {
      persistScoreRun(db, sampleArtifact, makeContract(1), sampleScoreReport(0.7, null));
      const trail = getArtifactAuditTrail(db, sampleArtifact);
      expect(trail!.runs[0].judge_score).toBeNull();
      expect(trail!.runs[0].source_trust).toBe(0.4);
    });
    it('无 source_trust 维度 → source_trust=null', () => {
      const report: ScoreReport = {
        deterministic: { violations: [], rubric_scores: [{ dim: 'cost_fit', score: 0.5, mode: 'deterministic', rationale: 'x' }], hard_violation_count: 0, deterministic_score: 0.5 },
        judge: null,
        final_score: 0.5,
      };
      persistScoreRun(db, sampleArtifact, makeContract(1), report);
      const trail = getArtifactAuditTrail(db, sampleArtifact);
      expect(trail!.runs[0].source_trust).toBeNull();
    });
  });
});

describe('P4.1 openAuditDB (env 驱动)', () => {
  const savedPath = process.env.CRUCIBLE_DB_PATH;
  const tmpFile = join(tmpdir(), `crucible-audit-test-${process.pid}-${Date.now()}.db`);

  afterEach(() => {
    if (savedPath === undefined) delete process.env.CRUCIBLE_DB_PATH;
    else process.env.CRUCIBLE_DB_PATH = savedPath;
    try { rmSync(tmpFile); rmSync(tmpFile + '-wal'); rmSync(tmpFile + '-shm'); } catch { /* ignore */ }
  });

  it('未设 CRUCIBLE_DB_PATH → null(不落库,行为零变化)', () => {
    delete process.env.CRUCIBLE_DB_PATH;
    expect(openAuditDB()).toBeNull();
  });
  it('设了 → 文件 DB(可读写 + 已 migrate)', () => {
    process.env.CRUCIBLE_DB_PATH = tmpFile;
    const db = openAuditDB();
    expect(db).not.toBeNull();
    const tables = (db!.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>).map(t => t.name);
    expect(tables).toContain('score_runs');
    db!.close();
  });
});

/** 辅助:不经 sink 直接查回 ScoreReport(复用 repositories.getScoreRun 语义)。 */
function getScoreRunBack(db: DB, artifact: unknown, version: number): ScoreReport | undefined {
  const hash = artifactHash(artifact);
  const row = db.prepare('SELECT report_json FROM score_runs WHERE artifact_hash = ? AND contract_version = ?').get(hash, version) as { report_json: string } | undefined;
  return row ? (JSON.parse(row.report_json) as ScoreReport) : undefined;
}
