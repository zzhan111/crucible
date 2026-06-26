import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadContract } from '../../src/contract/validate.js';
import { compileContract } from '../../src/contract/compiler.js';
import { applyContractPatch } from '../../src/contract/patch.js';
import { runABComparison } from '../../src/ab/comparison.js';
import type { ContractPatch } from '../../src/contract/patch.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONTRACT_PATH = join(__dirname, '..', '..', 'contracts', 'travel-sequence-v1.yaml');

describe('P1 §2.7 champion-challenger A/B', () => {
  const championContract = loadContract(CONTRACT_PATH);
  const championScorer = compileContract(championContract);

  // A/B 测试跑 16+ 次 LLM 调用,用降级模式避免真实 LLM(余额/速度/稳定性)
  // 真实 LLM A/B 验证由专门的手动脚本完成
  let savedKey: string | undefined;
  beforeEach(() => {
    savedKey = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
  });
  afterEach(() => {
    if (savedKey !== undefined) process.env.OPENAI_API_KEY = savedKey;
  });

  it('runABComparison 返回完整 ABResult', async () => {
    // challenger = champion 加一个约束(无实际影响,因黄金集无 beach)
    const patches: ContractPatch[] = [
      {
        op: 'add_constraint',
        constraint: { id: 'beach_hiking_mutex', type: 'declarative', mutex: ['beach', 'hiking'] },
        reason: 'novel state',
      },
    ];
    const { contract: challengerContract } = applyContractPatch(championContract, patches, false);
    const challengerScorer = compileContract(challengerContract);

    const result = await runABComparison(
      championContract,
      challengerContract,
      championScorer,
      challengerScorer
    );
    expect(result).toBeDefined();
    expect(result.champion_tau).toBeTypeOf('number');
    expect(result.challenger_tau).toBeTypeOf('number');
    expect(result.tau_delta).toBeCloseTo(result.challenger_tau - result.champion_tau, 5);
    expect(result.verdict).toMatch(/promote|retain/);
    expect(result.champion_ranking).toHaveLength(8);
    expect(result.challenger_ranking).toHaveLength(8);
    expect(result.human_ranking).toHaveLength(8);
  });

  it('champion 和 challenger 相同时 τ 相等 → retain', async () => {
    // challenger = champion(无修订),τ 完全相同
    const result = await runABComparison(
      championContract,
      championContract,
      championScorer,
      championScorer
    );
    expect(result.tau_delta).toBeCloseTo(0, 5);
    expect(result.verdict).toBe('retain');
  });

  it('champion_ranking 和 challenger_ranking 包含相同工件 ID 集合', async () => {
    const patches: ContractPatch[] = [
      {
        op: 'add_constraint',
        constraint: { id: 'noop_mutex', type: 'declarative', mutex: ['x', 'y'] },
        reason: 'test',
      },
    ];
    const { contract: challengerContract } = applyContractPatch(championContract, patches, false);
    const challengerScorer = compileContract(challengerContract);

    const result = await runABComparison(
      championContract,
      challengerContract,
      championScorer,
      challengerScorer
    );
    expect(new Set(result.champion_ranking)).toEqual(new Set(result.challenger_ranking));
  });

  it('降级模式(无 API key)τ 在 [-1,1],verdict 合理', async () => {
    const patches: ContractPatch[] = [
      { op: 'adjust_weight', dim: 'routing', new_weight: 0.35, reason: 'test' },
    ];
    const { contract: challengerContract } = applyContractPatch(championContract, patches, false);
    const challengerScorer = compileContract(challengerContract);

    const result = await runABComparison(
      championContract,
      challengerContract,
      championScorer,
      challengerScorer
    );
    expect(result.champion_tau).toBeGreaterThanOrEqual(-1);
    expect(result.champion_tau).toBeLessThanOrEqual(1);
    expect(result.challenger_tau).toBeGreaterThanOrEqual(-1);
    expect(result.challenger_tau).toBeLessThanOrEqual(1);
  });
});
