import { describe, it, expect, vi, beforeEach } from 'vitest';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadContract } from '../../src/contract/validate.js';
import { compileContract } from '../../src/contract/compiler.js';
import { createJudgeAugmentedScorer } from '../../src/scorer/augmented.js';
import { hk3dayBuggy } from '../../src/fixtures/hk-3day-buggy.js';
import { hk3dayGolden } from '../../src/fixtures/hk-3day-golden.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONTRACT_PATH = join(__dirname, '..', '..', 'contracts', 'travel-sequence-v1.yaml');

describe('JudgeAugmentedScorer', () => {
  beforeEach(() => {
    delete process.env.OPENROUTER_API_KEY;
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('produces ScoreReport with judge populated (neutral when no API key)', async () => {
    const contract = loadContract(CONTRACT_PATH);
    const baseScorer = compileContract(contract);
    const scorer = createJudgeAugmentedScorer(baseScorer, contract);
    const report = await scorer.score(hk3dayGolden);
    expect(report.judge).not.toBeNull();
    expect(report.judge!.rubric_scores).toHaveLength(3);
    const dims = report.judge!.rubric_scores.map(r => r.dim);
    expect(dims).toContain('routing');
    expect(dims).toContain('memorability');
    expect(dims).toContain('dining_fit');
    // neutral 0.5 each (no API key)
    expect(report.judge!.overall_score).toBeCloseTo(0.5, 2);
  });

  it('final_score = deterministic*0.6 + judge*0.4', async () => {
    const contract = loadContract(CONTRACT_PATH);
    const baseScorer = compileContract(contract);
    const scorer = createJudgeAugmentedScorer(baseScorer, contract);
    const report = await scorer.score(hk3dayGolden);
    const expected = report.deterministic.deterministic_score * 0.6 + report.judge!.overall_score * 0.4;
    expect(report.final_score).toBeCloseTo(expected, 4);
  });

  it('buggy scores lower than golden (deterministic violations dominate)', async () => {
    const contract = loadContract(CONTRACT_PATH);
    const baseScorer = compileContract(contract);
    const scorer = createJudgeAugmentedScorer(baseScorer, contract);
    const golden = await scorer.score(hk3dayGolden);
    const buggy = await scorer.score(hk3dayBuggy);
    expect(buggy.final_score).toBeLessThan(golden.final_score);
  });

  it('judge overall_score = weighted avg of judge rubric scores (normalized to judge dims)', async () => {
    const contract = loadContract(CONTRACT_PATH);
    const baseScorer = compileContract(contract);
    const scorer = createJudgeAugmentedScorer(baseScorer, contract);
    const report = await scorer.score(hk3dayGolden);
    const weights = { routing: 0.25, memorability: 0.25, dining_fit: 0.15 };
    let expected = 0;
    let weightSum = 0;
    for (const r of report.judge!.rubric_scores) {
      const w = weights[r.dim as keyof typeof weights] ?? 0;
      expected += r.score * w;
      weightSum += w;
    }
    expected = expected / weightSum;
    expect(report.judge!.overall_score).toBeCloseTo(expected, 4);
  });
});
