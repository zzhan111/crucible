import { describe, it, expect } from 'vitest';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadContract } from '../../src/contract/validate.js';
import { compileContract } from '../../src/contract/compiler.js';
import { ContractSchema } from '../../src/contract/schema.js';
import { hk3dayGolden } from '../../src/fixtures/hk-3day-golden.js';
import type { Contract } from '../../src/contract/schema.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONTRACT_PATH = join(__dirname, '..', '..', 'contracts', 'travel-sequence-v1.yaml');

/**
 * P1 §2.9 技术债:Contract YAML 跨版本兼容性测试(eng-review T3)。
 * 验证 Contract schema 的 forward/backward compat:
 * - 加 optional 字段(metadata)→ forward compat(旧 compiler 能跑)
 * - 删 optional 字段 → backward compat(新 compiler 不崩)
 */
describe('P1 §2.9 Contract 兼容性', () => {
  const baseContract = loadContract(CONTRACT_PATH);

  it('Contract 加 metadata.version 字段 → schema 仍合法', () => {
    const withVersion = { ...baseContract, metadata: { version: 2 } } as any;
    const result = ContractSchema.safeParse(withVersion);
    // metadata 不在 schema 定义中,zod 默认 strip 未知字段(strip mode)
    // safeParse 应成功(metadata 被 strip)
    expect(result.success).toBe(true);
  });

  it('Contract 无 metadata → schema 合法(metadata 可选)', () => {
    const { metadata, ...withoutMeta } = baseContract as any;
    const result = ContractSchema.safeParse(withoutMeta);
    expect(result.success).toBe(true);
  });

  it('Contract 加新 hard_constraint → compiler 跳过未知 ID 不崩', () => {
    const withNewConstraint = {
      ...baseContract,
      hard_constraints: [
        ...baseContract.hard_constraints,
        { id: 'future_constraint', type: 'declarative' as const, rule: 'not yet implemented' },
      ],
    };
    const scorer = compileContract(withNewConstraint);
    // 未知约束被跳过,已知约束仍编译
    expect(scorer.deterministicPredicateCount).toBe(baseContract.hard_constraints.length);
    // 能正常打分
    const report = scorer.score(hk3dayGolden);
    expect(report.deterministic.hard_violation_count).toBe(0);
  });

  it('Contract 加新 rubric dim → compiler 跳过未知 dim 不崩', () => {
    // 需要调整权重使 sum=1.0
    const adjustedRubric = baseContract.rubric.map(r => ({ ...r, weight: r.weight * 0.8 }));
    const withNewRubric: Contract = {
      ...baseContract,
      rubric: [
        ...adjustedRubric,
        { dim: 'future_metric', weight: 0.2, mode: 'deterministic' as const },
      ],
    };
    const scorer = compileContract(withNewRubric);
    // 未知 dim 被跳过,已知 dim 仍编译
    expect(scorer.deterministicRubricCount).toBeGreaterThanOrEqual(2);
    const report = scorer.score(hk3dayGolden);
    expect(report.final_score).toBeGreaterThanOrEqual(0);
  });

  it('Contract 删 optional calibration.human_ceiling → 仍合法', () => {
    const modified = {
      ...baseContract,
      calibration: {
        frozen_golden_set: baseContract.calibration.frozen_golden_set,
        metric: baseContract.calibration.metric,
        // human_ceiling 删除(optional)
      },
    };
    const result = ContractSchema.safeParse(modified);
    expect(result.success).toBe(true);
  });

  it('Contract rubric 权重 sum≠1.0 → schema 拒绝', () => {
    const badContract = {
      ...baseContract,
      rubric: [{ dim: 'routing', weight: 0.5, mode: 'judge' as const }],
    };
    const result = ContractSchema.safeParse(badContract);
    expect(result.success).toBe(false);
  });

  it('forward compat: v2 Contract(加 metadata.version)能在 v1 compiler 上跑', () => {
    const v2Contract = { ...baseContract, metadata: { version: 2 } } as any;
    const scorer = compileContract(v2Contract);
    const report = scorer.score(hk3dayGolden);
    expect(report.deterministic.hard_violation_count).toBe(0);
    // 和 v1 结果一致(metadata 不影响评分)
    const v1Scorer = compileContract(baseContract);
    const v1Report = v1Scorer.score(hk3dayGolden);
    expect(report.deterministic.deterministic_score).toBe(v1Report.deterministic.deterministic_score);
  });
});
