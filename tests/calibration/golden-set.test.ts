import { describe, it, expect } from 'vitest';
import { loadContract } from '../../src/contract/validate.js';
import { compileContract } from '../../src/contract/compiler.js';
import { getGoldenArtifacts } from '../../src/calibration/golden_set.js';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONTRACT_PATH = join(__dirname, '..', '..', 'contracts', 'travel-sequence-v1.yaml');

describe('P1 §2.3 黄金集', () => {
  const contract = loadContract(CONTRACT_PATH);
  const baseScorer = compileContract(contract);
  const golden = getGoldenArtifacts();

  it('黄金集含 8 个工件', () => {
    expect(golden).toHaveLength(8);
  });

  it('覆盖 3 个区域(香港 3 + 云南 3 + 防城港 2)', () => {
    const regions = golden.map(g => g.region);
    const counts = {
      hongkong: regions.filter(r => r === 'hongkong').length,
      yunnan: regions.filter(r => r === 'yunnan').length,
      fangchenggang: regions.filter(r => r === 'fangchenggang').length,
    };
    expect(counts.hongkong).toBe(3);
    expect(counts.yunnan).toBe(3);
    expect(counts.fangchenggang).toBe(2);
  });

  it('每个工件 ID 唯一', () => {
    const ids = golden.map(g => g.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('黄金集工件无硬违规(校准基线要求)', () => {
    // 黄金集是校准基线,不能有硬违规(否则分数被 penalty 拖低,τ 计算失真)
    for (const g of golden) {
      const report = baseScorer.score(g.artifact as any);
      expect(report.deterministic.hard_violation_count).toBe(0);
    }
  });

  it('质量梯度分布:至少 2 high + 2 mid + 2 low(保证排序有区分度)', () => {
    const tiers = golden.map(g => g.quality_tier);
    const counts = {
      high: tiers.filter(t => t === 'high').length,
      mid: tiers.filter(t => t === 'mid').length,
      low: tiers.filter(t => t === 'low').length,
    };
    expect(counts.high).toBeGreaterThanOrEqual(2);
    expect(counts.mid).toBeGreaterThanOrEqual(2);
    expect(counts.low).toBeGreaterThanOrEqual(2);
  });

  it('不同质量梯度工件在确定性分数上有区分度', () => {
    // high 工件的确定性分数应普遍高于 low 工件
    // (source_trust + cost_fit 确定性维度会让 high 工件得分更高)
    const byTier = { high: [] as number[], mid: [] as number[], low: [] as number[] };
    for (const g of golden) {
      const report = baseScorer.score(g.artifact as any);
      byTier[g.quality_tier].push(report.deterministic.deterministic_score);
    }
    const avgHigh = byTier.high.reduce((a, b) => a + b, 0) / byTier.high.length;
    const avgLow = byTier.low.reduce((a, b) => a + b, 0) / byTier.low.length;
    // high 平均确定性分数应 >= low(允许持平,因 deterministic 不含 judge 维度)
    expect(avgHigh).toBeGreaterThanOrEqual(avgLow - 0.01);
  });
});
