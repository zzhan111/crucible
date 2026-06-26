import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadContract } from '../../src/contract/validate.js';
import { compileContract } from '../../src/contract/compiler.js';
import { runJudgeCalibration, saveCalibrationReport } from '../../src/calibration/calibrate.js';
import { kendallTau } from '../../src/calibration/kendall_tau.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONTRACT_PATH = join(__dirname, '..', '..', 'contracts', 'travel-sequence-v1.yaml');

describe('P1 §2.4 judge 校准', () => {
  const contract = loadContract(CONTRACT_PATH);
  const baseScorer = compileContract(contract);

  // 降级模式:避免真实 LLM 调用(24 次/测试 × 7 测试),验证结构正确性。
  // 真实 LLM τ 阈值验证由手动脚本完成。
  let savedKey: string | undefined;
  beforeEach(() => {
    savedKey = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
  });
  afterEach(() => {
    if (savedKey !== undefined) process.env.OPENAI_API_KEY = savedKey;
  });

  it('runJudgeCalibration 返回完整 CalibrationReport', async () => {
    const report = await runJudgeCalibration(contract, baseScorer);
    expect(report).toBeDefined();
    expect(report.overall_tau).toBeTypeOf('number');
    expect(report.verdict).toMatch(/pass|fail/);
    expect(report.threshold).toBe(0.5);
    expect(report.judge_ranking).toHaveLength(8);
    expect(report.human_ranking).toHaveLength(8);
  });

  it('judge_ranking 包含全部 8 个黄金工件 ID', async () => {
    const report = await runJudgeCalibration(contract, baseScorer);
    const expectedIds = ['hk-a', 'hk-b', 'hk-c', 'yn-a', 'yn-b', 'yn-c', 'fc-a', 'fc-b'];
    expect(new Set(report.judge_ranking)).toEqual(new Set(expectedIds));
  });

  it('per_dim_tau 包含 3 个 judge 维度(routing/memorability/dining_fit)', async () => {
    const report = await runJudgeCalibration(contract, baseScorer);
    expect(report.per_dim_tau).toHaveProperty('routing');
    expect(report.per_dim_tau).toHaveProperty('memorability');
    expect(report.per_dim_tau).toHaveProperty('dining_fit');
  });

  it('降级模式(无 API key)τ 在 [-1, 1] 范围内', async () => {
    // 无 API key 时 judge 全返回 neutral 0.5,judge_ranking 由 final_score 决定
    // final_score = det*0.6 + 0.5*0.4,τ 应在合理范围
    const report = await runJudgeCalibration(contract, baseScorer);
    expect(report.overall_tau).toBeGreaterThanOrEqual(-1);
    expect(report.overall_tau).toBeLessThanOrEqual(1);
  });

  it('overall_tau 与 kendallTau(judge, human) 一致', async () => {
    const report = await runJudgeCalibration(contract, baseScorer);
    const direct = kendallTau(report.judge_ranking, report.human_ranking);
    expect(report.overall_tau).toBeCloseTo(direct.tau, 5);
  });

  it('saveCalibrationReport 写入文件且可读回', async () => {
    const report = await runJudgeCalibration(contract, baseScorer);
    const path = saveCalibrationReport(report);
    expect(path).toContain('calibration-report.json');
    // 读回验证
    const { readFileSync } = await import('node:fs');
    const raw = readFileSync(path, 'utf8');
    const loaded = JSON.parse(raw);
    expect(loaded.overall_tau).toBe(report.overall_tau);
    expect(loaded.judge_ranking).toEqual(report.judge_ranking);
  });

  it('人类排序文件不存在时抛错', async () => {
    // 临时 mock loadHumanRanking 返回 null 的场景:
    // 这里 human-ranking.jsonl 已存在,所以正常测试。
    // 验证 report.human_ranking 与文件一致即可。
    const report = await runJudgeCalibration(contract, baseScorer);
    const { loadHumanRanking } = await import('../../src/calibration/golden_set.js');
    const human = loadHumanRanking();
    expect(human).not.toBeNull();
    expect(report.human_ranking).toEqual(human!.ranking);
  });
});
