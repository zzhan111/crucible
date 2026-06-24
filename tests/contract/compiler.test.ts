import { describe, it, expect } from 'vitest';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileContract } from '../../src/contract/compiler.js';
import { loadContract } from '../../src/contract/validate.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONTRACT_PATH = join(__dirname, '..', '..', 'contracts', 'travel-sequence-v1.yaml');

describe('compileContract', () => {
  it('compiles travel-sequence-v1 into a Scorer with 4 predicates and 2 deterministic rubrics', () => {
    const contract = loadContract(CONTRACT_PATH);
    const scorer = compileContract(contract);
    expect(scorer).toBeDefined();
    expect(typeof scorer.score).toBe('function');
    expect(scorer.deterministicPredicateCount).toBe(4);
    expect(scorer.deterministicRubricCount).toBe(2);
  });

  it('scorer.score returns a ScoreReport with deterministic populated', () => {
    const contract = loadContract(CONTRACT_PATH);
    const scorer = compileContract(contract);
    const artifact = {
      family: 'sequence' as const,
      nodes: [
        { node_type: 'dining', duration_min: 30, action: 'breakfast', state: [] },
        { node_type: 'transit', duration_min: 15, action: 'walk to mtr' },
        { node_type: 'core_experience', duration_min: 120, action: 'hike' },
      ],
    };
    const report = scorer.score(artifact);
    expect(report.deterministic).toBeDefined();
    expect(report.deterministic.hard_violation_count).toBe(0);
    expect(report.judge).toBeNull();
    expect(report.final_score).toBeGreaterThan(0);
  });

  // 错误路径测试(eng-review T1):compiler 静默跳过行为的契约
  it('silently skips state_mutex when mutex field is missing or has fewer than 2 tokens', () => {
    const contract = loadContract(CONTRACT_PATH);
    // 篡改:把 state_mutex 的 mutex 字段删掉
    const broken = {
      ...contract,
      hard_constraints: contract.hard_constraints.map(c =>
        c.id === 'state_mutex'
          ? { id: 'state_mutex', type: 'declarative' as const }
          : c
      ),
    };
    const scorer = compileContract(broken);
    // state_mutex 被跳过,只剩 3 个谓词
    expect(scorer.deterministicPredicateCount).toBe(3);
  });

  it('silently skips unknown constraint IDs', () => {
    const contract = loadContract(CONTRACT_PATH);
    const withUnknown = {
      ...contract,
      hard_constraints: [
        ...contract.hard_constraints,
        { id: 'my_custom_check', type: 'declarative' as const, rule: 'whatever' },
      ],
    };
    const scorer = compileContract(withUnknown);
    // 4 个已知 + 1 个未知被跳过 = 仍 4 个
    expect(scorer.deterministicPredicateCount).toBe(4);
  });

  it('does not compile judge-mode rubrics into deterministic scorer', () => {
    const contract = loadContract(CONTRACT_PATH);
    const scorer = compileContract(contract);
    // Contract 有 5 个 rubric,其中 2 deterministic + 3 judge/proxy+judge
    // deterministicRubricCount 应该只有 2
    expect(scorer.deterministicRubricCount).toBe(2);
    // 跑一次 score,rubric_scores 只含 deterministic 维度
    const artifact = {
      family: 'sequence' as const,
      nodes: [{ node_type: 'dining', duration_min: 30, action: 'x' }],
    };
    const report = scorer.score(artifact);
    const dims = report.deterministic.rubric_scores.map(r => r.dim);
    expect(dims).toEqual(expect.arrayContaining(['cost_fit', 'source_trust']));
    expect(dims).not.toContain('routing');
    expect(dims).not.toContain('memorability');
    expect(dims).not.toContain('dining_fit');
  });
});
