import { describe, it, expect, vi, beforeEach } from 'vitest';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadContract } from '../../src/contract/validate.js';
import { compileContract } from '../../src/contract/compiler.js';
import type { Contract } from '../../src/contract/schema.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONTRACT_PATH = join(__dirname, '..', '..', 'contracts', 'travel-sequence-v1.yaml');

/**
 * P4.6.1: compiler warnings on silent skips.
 *
 * Forward compat 仍保留(跳过不崩,见 compat.test.ts),但跳过应可观测:
 * - warnings: string[] 字段供编程查询
 * - console.warn 立即可见
 *
 * 覆盖 3 个跳过点:未知 declarative id / 未知 deterministic dim / state_mutex mutex 字段无效
 */
describe('P4.6.1 compiler warnings(可观测的 forward-compat 跳过)', () => {
  const baseContract = loadContract(CONTRACT_PATH);

  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('已知契约 → warnings 为空', () => {
    const scorer = compileContract(baseContract);
    expect(scorer.warnings).toEqual([]);
    expect(console.warn).not.toHaveBeenCalled();
  });

  it('未知 declarative id → warning + 仍跳过不崩(forward compat 保留)', () => {
    const c: Contract = {
      ...baseContract,
      hard_constraints: [
        ...baseContract.hard_constraints,
        { id: 'future_constraint', type: 'declarative', rule: 'not yet implemented' },
      ],
    };
    const scorer = compileContract(c);
    expect(scorer.warnings).toHaveLength(1);
    expect(scorer.warnings[0]).toContain('future_constraint');
    expect(scorer.warnings[0]).toContain('forward compat');
    // 已知约束数量不变(未知被跳过)
    expect(scorer.deterministicPredicateCount).toBe(baseContract.hard_constraints.length);
    expect(console.warn).toHaveBeenCalledOnce();
  });

  it('未知 deterministic rubric dim → warning + 跳过', () => {
    const adjusted = baseContract.rubric.map(r => ({ ...r, weight: r.weight * 0.8 }));
    const c: Contract = {
      ...baseContract,
      rubric: [
        ...adjusted,
        { dim: 'future_metric', weight: 0.2, mode: 'deterministic' as const },
      ],
    };
    const scorer = compileContract(c);
    expect(scorer.warnings).toHaveLength(1);
    expect(scorer.warnings[0]).toContain('future_metric');
    expect(scorer.warnings[0]).toContain('rubric dim');
    expect(console.warn).toHaveBeenCalledOnce();
  });

  it('judge / proxy+judge rubric dim 未知 → 不告警(只有 deterministic 才告警)', () => {
    // judge mode 的 dim 由 fanoutJudges 处理,不走 compiler 注册表,不应告警
    const adjusted = baseContract.rubric.map(r => ({ ...r, weight: r.weight * 0.8 }));
    const c: Contract = {
      ...baseContract,
      rubric: [
        ...adjusted,
        { dim: 'some_future_judge_dim', weight: 0.2, mode: 'judge' as const },
      ],
    };
    const scorer = compileContract(c);
    expect(scorer.warnings).toEqual([]);
  });

  it('state_mutex 注册但 mutex 字段缺失 → warning(契约错误,非 forward compat)', () => {
    const c: Contract = {
      ...baseContract,
      hard_constraints: [
        // 故意省略 mutex 字段
        { id: 'state_mutex', type: 'declarative', rule: 'broken' },
        ...baseContract.hard_constraints.filter(hc => hc.id !== 'state_mutex'),
      ],
    };
    const scorer = compileContract(c);
    const stateMutexWarning = scorer.warnings.find(w => w.includes('state_mutex'));
    expect(stateMutexWarning).toBeDefined();
    expect(stateMutexWarning).toContain('mutex field missing');
  });

  it('多个未知 id + 未知 dim → warnings 全部收集', () => {
    const adjusted = baseContract.rubric.map(r => ({ ...r, weight: r.weight * 0.7 }));
    const c: Contract = {
      ...baseContract,
      hard_constraints: [
        ...baseContract.hard_constraints,
        { id: 'future_a', type: 'declarative', rule: '' },
        { id: 'future_b', type: 'declarative', rule: '' },
      ],
      rubric: [
        ...adjusted,
        { dim: 'future_dim', weight: 0.3, mode: 'deterministic' as const },
      ],
    };
    const scorer = compileContract(c);
    expect(scorer.warnings).toHaveLength(3);
    expect(scorer.warnings.some(w => w.includes('future_a'))).toBe(true);
    expect(scorer.warnings.some(w => w.includes('future_b'))).toBe(true);
    expect(scorer.warnings.some(w => w.includes('future_dim'))).toBe(true);
  });
});
