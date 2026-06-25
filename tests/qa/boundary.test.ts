/**
 * QA Phase 3: 边界 case 测试
 * 探查 coverage 弱点 + 潜在 crash 路径
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadContract } from '../../src/contract/validate.js';
import { compileContract } from '../../src/contract/compiler.js';
import { createJudgeAugmentedScorer } from '../../src/scorer/augmented.js';
import { applyPatches } from '../../src/patch/apply.js';
import { generatePatches } from '../../src/agents/critic.js';
import { detectNovelty } from '../../src/agents/curator.js';
import { fanoutJudges } from '../../src/rubric/fanout.js';
import { parseJudgeScore } from '../../src/rubric/judge-types.js';
import { makeStateMutex } from '../../src/predicates/state_mutex.js';
import type { Artifact } from '../../src/predicates/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONTRACT_PATH = join(__dirname, '..', '..', 'contracts', 'travel-sequence-v1.yaml');

describe('QA Phase 3: 边界 case', () => {
  beforeEach(() => {
    delete process.env.OPENROUTER_API_KEY;
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  describe('empty artifact', () => {
    it('compileContract + score on empty nodes', () => {
      const contract = loadContract(CONTRACT_PATH);
      const scorer = compileContract(contract);
      const empty: Artifact = { family: 'sequence', nodes: [] };
      const report = scorer.score(empty);
      expect(report.deterministic.hard_violation_count).toBe(0);
      expect(report.deterministic.deterministic_score).toBe(1.0);
    });

    it('Critic generatePatches on empty artifact', async () => {
      const contract = loadContract(CONTRACT_PATH);
      const scorer = compileContract(contract);
      const empty: Artifact = { family: 'sequence', nodes: [] };
      const report = scorer.score(empty);
      const patches = await generatePatches(report, empty);
      expect(patches).toEqual([]);
    });

    it('Curator detectNovelty on empty artifact', async () => {
      const empty: Artifact = { family: 'sequence', nodes: [] };
      const proposals = await detectNovelty(empty, []);
      expect(proposals).toEqual([]);
    });
  });

  describe('NaN / undefined fields', () => {
    it('timeBudget handles NaN duration_min', () => {
      const contract = loadContract(CONTRACT_PATH);
      const scorer = compileContract(contract);
      const artifact: Artifact = {
        family: 'sequence',
        nodes: [
          { node_type: 'dining', duration_min: NaN, action: 'x' },
          { node_type: 'transit', duration_min: 30 },
        ],
      };
      const report = scorer.score(artifact);
      // NaN 应被 typeof 检查跳过,只算 30
      expect(report.deterministic.hard_violation_count).toBe(0);
    });

    it('costFit handles NaN cost', () => {
      const contract = loadContract(CONTRACT_PATH);
      const scorer = compileContract(contract);
      const artifact: Artifact = {
        family: 'sequence',
        metadata: { budget: { min: 0, max: 100 } },
        nodes: [{ node_type: 'dining', cost: NaN, duration_min: 30 }],
      };
      const report = scorer.score(artifact);
      // NaN cost 被跳过,total=0 ≤ 100 → cost_fit=1.0
      const costFit = report.deterministic.rubric_scores.find(r => r.dim === 'cost_fit');
      expect(costFit?.score).toBe(1.0);
    });

    it('sourceTrust handles undefined source_trust field', () => {
      const contract = loadContract(CONTRACT_PATH);
      const scorer = compileContract(contract);
      const artifact: Artifact = {
        family: 'sequence',
        nodes: [{ node_type: 'dining', duration_min: 30, action: 'x' }], // 无 source_trust
      };
      const report = scorer.score(artifact);
      const st = report.deterministic.rubric_scores.find(r => r.dim === 'source_trust');
      expect(st?.score).toBe(0.0); // 缺失按 0.0
    });

    it('state_mutex handles node without state field', () => {
      const predicate = makeStateMutex(['a', 'b']);
      const artifact: Artifact = {
        family: 'sequence',
        nodes: [{ action: 'x' }, { action: 'y' }], // 无 state 字段
      };
      expect(predicate(artifact)).toEqual([]);
    });
  });

  describe('parseJudgeScore edge cases', () => {
    it('handles empty string', () => {
      expect(parseJudgeScore('', 'x')).toBe(0.5);
    });

    it('handles negative number', () => {
      expect(parseJudgeScore('-0.5', 'x')).toBe(0.5); // < 0 → 0.5
    });

    it('handles number > 100', () => {
      expect(parseJudgeScore('150', 'x')).toBe(0.5); // > 100 → 0.5
    });

    it('handles "0.85 confidence"', () => {
      expect(parseJudgeScore('0.85 confidence', 'x')).toBe(0.85);
    });

    it('handles "85 out of 100"', () => {
      expect(parseJudgeScore('85 out of 100', 'x')).toBe(0.85); // 第一个数字 85 → 0.85
    });
  });

  describe('applyPatches edge cases', () => {
    it('insert at after_index = last index', () => {
      const artifact: Artifact = {
        family: 'sequence',
        nodes: [{ action: 'a' }, { action: 'b' }],
      };
      const result = applyPatches(artifact, [
        { type: 'insert', after_index: 1, node: { action: 'c' }, reason: 'x' },
      ]);
      expect(result.nodes.map(n => n.action)).toEqual(['a', 'b', 'c']);
    });

    it('delete only node', () => {
      const artifact: Artifact = {
        family: 'sequence',
        nodes: [{ action: 'a' }],
      };
      const result = applyPatches(artifact, [
        { type: 'delete', index: 0, reason: 'x' },
      ]);
      expect(result.nodes).toHaveLength(0);
    });

    it('update_field on non-existent field', () => {
      const artifact: Artifact = {
        family: 'sequence',
        nodes: [{ action: 'a' }],
      };
      const result = applyPatches(artifact, [
        { type: 'update_field', index: 0, field: 'new_field', value: 42, reason: 'x' },
      ]);
      expect(result.nodes[0].new_field).toBe(42);
    });
  });

  describe('Critic edge cases', () => {
    it('handles violation with missing location fields', async () => {
      const contract = loadContract(CONTRACT_PATH);
      const scorer = compileContract(contract);
      // 构造一个 violation,location 只有部分字段
      const report = {
        deterministic: {
          violations: [{
            constraint_id: 'continuity',
            severity: 'hard' as const,
            message: 'gap',
            location: {}, // 缺 node_index
            fix_hint: 'insert transit',
          }],
          rubric_scores: [],
          hard_violation_count: 1,
          deterministic_score: 0.85,
        },
        judge: null,
        final_score: 0.85,
      };
      const artifact: Artifact = {
        family: 'sequence',
        nodes: [{ node_type: 'dining' }, { node_type: 'core_experience' }],
      };
      // 不应 crash,用默认值 ?? 0
      const patches = await generatePatches(report, artifact);
      expect(patches.length).toBeGreaterThanOrEqual(1);
    });

    it('handles state_mutex violation with empty states array', async () => {
      const report = {
        deterministic: {
          violations: [{
            constraint_id: 'state_mutex',
            severity: 'hard' as const,
            message: 'node 0 holds both mutex states: a and b',
            location: { node_index: 0, field: 'state' },
            fix_hint: 'remove one',
          }],
          rubric_scores: [],
          hard_violation_count: 1,
          deterministic_score: 0.85,
        },
        judge: null,
        final_score: 0.85,
      };
      const artifact: Artifact = {
        family: 'sequence',
        nodes: [{ action: 'x', state: [] }], // 空 state,但 message 说有 a 和 b
      };
      // 不应 crash,mutexTokens 为空,toRemove 是 undefined
      const patches = await generatePatches(report, artifact);
      // 会生成 update_field patch,value 是空数组 filter undefined
      expect(patches.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('JudgeAugmentedScorer edge cases', () => {
    it('handles artifact with only dining nodes (no transit/core)', async () => {
      const contract = loadContract(CONTRACT_PATH);
      const baseScorer = compileContract(contract);
      const scorer = createJudgeAugmentedScorer(baseScorer, contract);
      const artifact: Artifact = {
        family: 'sequence',
        nodes: [
          { node_type: 'dining', action: 'breakfast', duration_min: 30 },
          { node_type: 'dining', action: 'lunch', duration_min: 60 },
        ],
      };
      const report = await scorer.score(artifact);
      // 两个 dining 相邻 → continuity 违规
      expect(report.deterministic.hard_violation_count).toBe(1);
      expect(report.judge).not.toBeNull();
    });

    it('handles single-node artifact', async () => {
      const contract = loadContract(CONTRACT_PATH);
      const baseScorer = compileContract(contract);
      const scorer = createJudgeAugmentedScorer(baseScorer, contract);
      const artifact: Artifact = {
        family: 'sequence',
        nodes: [{ node_type: 'dining', action: 'solo', duration_min: 30 }],
      };
      const report = await scorer.score(artifact);
      expect(report.deterministic.hard_violation_count).toBe(0);
      expect(report.final_score).toBeGreaterThan(0);
    });
  });

  describe('fanoutJudges edge cases', () => {
    it('handles artifact with no dining nodes (dining_fit judge gets empty input)', async () => {
      const contract = loadContract(CONTRACT_PATH);
      const artifact: Artifact = {
        family: 'sequence',
        nodes: [{ node_type: 'transit', action: 'walk' }],
      };
      const results = await fanoutJudges(artifact, contract);
      expect(results).toHaveLength(3);
      const diningFit = results.find(r => r.dim === 'dining_fit');
      expect(diningFit).toBeDefined();
      // 无 API key → 0.5 neutral
      expect(diningFit!.score).toBe(0.5);
    });
  });
});
