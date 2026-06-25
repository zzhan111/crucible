import { describe, it, expect, vi, beforeEach } from 'vitest';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadContract } from '../../src/contract/validate.js';
import { compileContract } from '../../src/contract/compiler.js';
import { runCrucibleWorkflow } from '../../src/workflow/crucible.js';
import { hk3dayBuggy } from '../../src/fixtures/hk-3day-buggy.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONTRACT_PATH = join(__dirname, '..', '..', 'contracts', 'travel-sequence-v1.yaml');

describe('runCrucibleWorkflow', () => {
  beforeEach(() => {
    delete process.env.OPENAI_API_KEY;
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('runs 3 iterations max and produces final artifact', async () => {
    const contract = loadContract(CONTRACT_PATH);
    const baseScorer = compileContract(contract);
    const result = await runCrucibleWorkflow({
      artifact: hk3dayBuggy,
      contract,
      baseScorer,
      artifactId: 'test-run',
      knownStates: ['at_hotel', 'hiking', 'luggage_drop', 'depart_from_hotel'],
    });
    expect(result.iterations.length).toBeGreaterThanOrEqual(1);
    expect(result.iterations.length).toBeLessThanOrEqual(3);
    expect(result.finalArtifact).toBeDefined();
    expect(result.finalScore).toBeGreaterThanOrEqual(0);
  });

  it('hard violations decrease or reach zero over iterations', async () => {
    const contract = loadContract(CONTRACT_PATH);
    const baseScorer = compileContract(contract);
    const result = await runCrucibleWorkflow({
      artifact: hk3dayBuggy,
      contract,
      baseScorer,
      artifactId: 'test-violations',
      knownStates: ['at_hotel', 'hiking', 'luggage_drop', 'depart_from_hotel'],
    });
    const violations = result.iterations.map(i => i.violations);
    // 违规数应非递增(Critic 修复后减少或不变)
    for (let i = 1; i < violations.length; i++) {
      expect(violations[i]).toBeLessThanOrEqual(violations[i - 1]);
    }
  });

  // eng-review T1:验证 iteration.score 是 post-patch 分数(A1 修复),非递减 + 至少一轮提升
  it('iteration scores are non-decreasing with at least one improvement (post-patch scores recorded)', async () => {
    const contract = loadContract(CONTRACT_PATH);
    const baseScorer = compileContract(contract);
    const result = await runCrucibleWorkflow({
      artifact: hk3dayBuggy,
      contract,
      baseScorer,
      artifactId: 'test-monotonic',
      knownStates: ['at_hotel', 'hiking', 'luggage_drop', 'depart_from_hotel'],
    });
    expect(result.iterations.length).toBeGreaterThanOrEqual(2);
    const scores = result.iterations.map(i => i.score);
    // post-patch score 应非递减(Critic 修复违规 → 分数上升或持平)
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i]).toBeGreaterThanOrEqual(scores[i - 1] - 0.001); // 容差
    }
    // 至少一轮严格提升(v1→v2 违规修复)
    const improvements = [];
    for (let i = 1; i < scores.length; i++) {
      improvements.push(scores[i] - scores[i - 1]);
    }
    expect(Math.max(...improvements)).toBeGreaterThan(0.01);
  });
});
