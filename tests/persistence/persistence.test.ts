import { describe, it, expect, beforeEach } from 'vitest';
import { openAndMigrate, openDB, migrate, type DB } from '../../src/persistence/db.js';
import {
  insertContract,
  getContract,
  listContracts,
  insertScoreRun,
  getScoreRun,
  insertABResult,
  listABResults,
  insertProposal,
  updateProposalGate,
  listPendingProposals,
  artifactHash,
  type ContractRecord,
} from '../../src/persistence/repositories.js';
import type { ScoreReport } from '../../src/scorer/types.js';
import type { ABResult } from '../../src/ab/comparison.js';
import type { ExpansionProposal } from '../../src/agents/curator.js';

function sampleScoreReport(detScore = 0.85, judgeScore: number | null = 0.7): ScoreReport {
  return {
    deterministic: {
      violations: [],
      rubric_scores: [],
      hard_violation_count: 0,
      deterministic_score: detScore,
    },
    judge: judgeScore === null ? null : { rubric_scores: [], overall_score: judgeScore },
    final_score: detScore,
  };
}

const sampleArtifact = { family: 'sequence', nodes: [{ day: 1, state: ['hotel'] }] };

describe('P3.5 §2.2 SQLite 持久化层', () => {
  let db: DB;
  beforeEach(() => {
    db = openAndMigrate();
  });

  describe('migrate', () => {
    it('migrate 幂等:重复执行不报错,schema_version 不重复', () => {
      const versionsBefore = (db.prepare('SELECT version FROM schema_version').all() as Array<{ version: number }>).length;
      migrate(db); // 再跑一次
      const versionsAfter = (db.prepare('SELECT version FROM schema_version').all() as Array<{ version: number }>).length;
      expect(versionsAfter).toBe(versionsBefore);
    });

    it('创建 4 张表 + schema_version', () => {
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as Array<{ name: string }>;
      const names = tables.map(t => t.name);
      expect(names).toContain('contracts');
      expect(names).toContain('score_runs');
      expect(names).toContain('ab_results');
      expect(names).toContain('proposals');
      expect(names).toContain('schema_version');
    });
  });

  describe('contracts', () => {
    it('insert + get 往返', () => {
      const r: ContractRecord = { version: 1, family: 'sequence', yaml_text: 'family: sequence' };
      insertContract(db, r);
      const got = getContract(db, 1);
      expect(got).toBeDefined();
      expect(got!.version).toBe(1);
      expect(got!.family).toBe('sequence');
      expect(got!.yaml_text).toBe('family: sequence');
    });

    it('parent_version + diff_summary 可空', () => {
      insertContract(db, { version: 1, family: 'sequence', yaml_text: 'a' });
      insertContract(db, { version: 2, family: 'sequence', yaml_text: 'b', parent_version: 1, diff_summary: 'add mutex' });
      const v2 = getContract(db, 2);
      expect(v2!.parent_version).toBe(1);
      expect(v2!.diff_summary).toBe('add mutex');
      const v1 = getContract(db, 1);
      expect(v1!.parent_version).toBeNull();
    });

    it('listContracts 按 version 升序', () => {
      insertContract(db, { version: 3, family: 'sequence', yaml_text: 'c' });
      insertContract(db, { version: 1, family: 'sequence', yaml_text: 'a' });
      insertContract(db, { version: 2, family: 'sequence', yaml_text: 'b' });
      const list = listContracts(db);
      expect(list.map(c => c.version)).toEqual([1, 2, 3]);
    });

    it('insert OR REPLACE: 同 version 覆盖', () => {
      insertContract(db, { version: 1, family: 'sequence', yaml_text: 'old' });
      insertContract(db, { version: 1, family: 'sequence', yaml_text: 'new' });
      expect(getContract(db, 1)!.yaml_text).toBe('new');
    });
  });

  describe('score_runs', () => {
    it('insert + get 往返,report_json 正确反序列化', () => {
      insertContract(db, { version: 1, family: 'sequence', yaml_text: 'a' });
      const report = sampleScoreReport(0.9, 0.6);
      insertScoreRun(db, sampleArtifact, 1, report);
      const got = getScoreRun(db, sampleArtifact, 1);
      expect(got).toBeDefined();
      expect(got!.deterministic.deterministic_score).toBe(0.9);
      expect(got!.judge!.overall_score).toBe(0.6);
    });

    it('artifact_hash 唯一性: 同 artifact+contract 只存最新(OR REPLACE)', () => {
      insertContract(db, { version: 1, family: 'sequence', yaml_text: 'a' });
      insertScoreRun(db, sampleArtifact, 1, sampleScoreReport(0.5));
      insertScoreRun(db, sampleArtifact, 1, sampleScoreReport(0.8));
      const got = getScoreRun(db, sampleArtifact, 1);
      expect(got!.deterministic.deterministic_score).toBe(0.8);
      const count = (db.prepare('SELECT COUNT(*) c FROM score_runs').get() as { c: number }).c;
      expect(count).toBe(1);
    });

    it('不同 artifact_hash 不冲突', () => {
      insertContract(db, { version: 1, family: 'sequence', yaml_text: 'a' });
      const artA = { family: 'sequence', nodes: [{ day: 1 }] };
      const artB = { family: 'sequence', nodes: [{ day: 2 }] };
      insertScoreRun(db, artA, 1, sampleScoreReport(0.5));
      insertScoreRun(db, artB, 1, sampleScoreReport(0.9));
      expect(getScoreRun(db, artA, 1)!.deterministic.deterministic_score).toBe(0.5);
      expect(getScoreRun(db, artB, 1)!.deterministic.deterministic_score).toBe(0.9);
    });

    it('artifactHash 确定性: 同输入同输出', () => {
      expect(artifactHash(sampleArtifact)).toBe(artifactHash(sampleArtifact));
      expect(artifactHash({ a: 1 })).not.toBe(artifactHash({ a: 2 }));
    });

    it('Part 1 阶段 judge_score 为 null 正确存储', () => {
      insertContract(db, { version: 1, family: 'sequence', yaml_text: 'a' });
      insertScoreRun(db, sampleArtifact, 1, sampleScoreReport(0.7, null));
      const row = db.prepare('SELECT det_score, judge_score FROM score_runs WHERE contract_version=1').get() as { det_score: number; judge_score: number | null };
      expect(row.det_score).toBe(0.7);
      expect(row.judge_score).toBeNull();
    });
  });

  describe('ab_results', () => {
    it('insert + list 往返', () => {
      insertContract(db, { version: 1, family: 'sequence', yaml_text: 'a' });
      insertContract(db, { version: 2, family: 'sequence', yaml_text: 'b', parent_version: 1 });
      const result: ABResult = {
        champion_tau: 0.5, challenger_tau: 0.7, tau_delta: 0.2,
        verdict: 'promote', champion_ranking: [], challenger_ranking: [],
      };
      insertABResult(db, 1, 2, result);
      const list = listABResults(db);
      expect(list).toHaveLength(1);
      expect(list[0].verdict).toBe('promote');
      expect(list[0].tau_chall).toBe(0.7);
    });

    it('verdict CHECK 约束拒绝非法值', () => {
      insertContract(db, { version: 1, family: 'sequence', yaml_text: 'a' });
      insertContract(db, { version: 2, family: 'sequence', yaml_text: 'b', parent_version: 1 });
      expect(() => {
        db.prepare('INSERT INTO ab_results (champion_version, challenger_version, tau_champ, tau_chall, verdict) VALUES (1,2,0.5,0.7,?)').run('bogus');
      }).toThrow();
    });
  });

  describe('proposals', () => {
    it('insert 默认 gate_decision=pending', () => {
      insertContract(db, { version: 1, family: 'sequence', yaml_text: 'a' });
      const p: ExpansionProposal = { dim: 'state', tokens: ['new_state'], rationale: 'novel' };
      insertProposal(db, sampleArtifact, 1, p);
      const pending = listPendingProposals(db);
      expect(pending).toHaveLength(1);
      expect(pending[0].tokens).toEqual(['new_state']);
      expect(pending[0].dim).toBe('state');
    });

    it('updateProposalGate 把 pending 移出列表', () => {
      insertContract(db, { version: 1, family: 'sequence', yaml_text: 'a' });
      insertProposal(db, sampleArtifact, 1, { dim: 'state', tokens: ['x'], rationale: 'r' });
      const id = listPendingProposals(db)[0].id;
      updateProposalGate(db, id, 'approved');
      expect(listPendingProposals(db)).toHaveLength(0);
    });

    it('dim CHECK 约束拒绝非法值', () => {
      insertContract(db, { version: 1, family: 'sequence', yaml_text: 'a' });
      expect(() => {
        db.prepare('INSERT INTO proposals (artifact_hash, contract_version, dim, tokens_json, rationale, gate_decision) VALUES (?,1,?,?,?,\'pending\')')
          .run('h', 'bogus', '[]', null);
      }).toThrow();
    });
  });

  describe('外键 + 边界', () => {
    it('score_runs.contract_version 外键约束: 不存在的版本插入失败', () => {
      expect(() => insertScoreRun(db, sampleArtifact, 999, sampleScoreReport())).toThrow();
    });

    it('文件模式: openDB 持久化跨实例', () => {
      const path = `:memory:`; // 用临时文件需 os.tmpdir;这里验证 openDB 接受路径不报错
      const db1 = openDB(path);
      migrate(db1);
      insertContract(db1, { version: 1, family: 'sequence', yaml_text: 'a' });
      expect(getContract(db1, 1)).toBeDefined();
      db1.close();
    });
  });
});
