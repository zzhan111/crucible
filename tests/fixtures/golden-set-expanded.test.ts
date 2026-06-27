import { describe, it, expect } from 'vitest';
import {
  EXPANDED_GOLDEN,
  CALIBRATION_GOLDEN,
  DETECTION_GOLDEN,
  type ExpandedGoldenEntry,
} from '../../src/fixtures/golden-set-expanded.js';
import { GOLDEN_ARTIFACTS } from '../../src/fixtures/golden-set.js';
import { computeGoldenStats, computeFieldStats } from '../../src/curator/novelty_v2.js';

describe('P3.5 §2.4 扩容黄金集', () => {
  it('总工件数 ≥ 20', () => {
    expect(EXPANDED_GOLDEN.length).toBeGreaterThanOrEqual(20);
  });

  it('包含 P1 原 8 个工件(calibration)', () => {
    const ids = EXPANDED_GOLDEN.map(e => e.id);
    for (const g of GOLDEN_ARTIFACTS) {
      expect(ids).toContain(g.id);
    }
  });

  it('calibration 工件全部无 violation 标记', () => {
    for (const e of CALIBRATION_GOLDEN.map((artifact, i) => ({ ...EXPANDED_GOLDEN.filter(x => x.purpose === 'calibration')[i], artifact }))) {
      expect((e as ExpandedGoldenEntry).violation).toBe('none');
    }
  });

  it('detection 工件全部有 violation 标记(非 none)', () => {
    for (const e of DETECTION_GOLDEN) {
      expect(e.violation).not.toBe('none');
    }
  });

  it('每个 violation pattern 至少 1 个 detection 样本', () => {
    const patterns = ['time_budget', 'state_mutex', 'duplicate_state', 'continuity', 'missing_source', 'pricing_format', 'duplicate_competitor'];
    for (const p of patterns) {
      expect(EXPANDED_GOLDEN.filter(e => e.violation === p).length).toBeGreaterThanOrEqual(1);
    }
  });

  it('覆盖率矩阵:sequence 族每个 quality_tier ≥ 2 calibration', () => {
    for (const tier of ['high', 'mid', 'low'] as const) {
      const n = EXPANDED_GOLDEN.filter(e => e.family === 'sequence' && e.quality_tier === tier && e.purpose === 'calibration').length;
      expect(n).toBeGreaterThanOrEqual(2);
    }
  });

  it('覆盖率矩阵:table 族至少有 calibration 样本', () => {
    const n = EXPANDED_GOLDEN.filter(e => e.family === 'table' && e.purpose === 'calibration').length;
    expect(n).toBeGreaterThanOrEqual(3);
  });

  it('calibration 集数值字段有统计意义(n ≥ 2 且 std > 0)', () => {
    const stats = computeGoldenStats(CALIBRATION_GOLDEN);
    expect(stats.cost.n).toBeGreaterThanOrEqual(2);
    expect(stats.cost.std).toBeGreaterThan(0);
    expect(stats.duration_min.n).toBeGreaterThanOrEqual(2);
    expect(stats.source_trust.n).toBeGreaterThanOrEqual(2);
  });

  it('每个工件 family 合法', () => {
    for (const e of EXPANDED_GOLDEN) {
      expect(['sequence', 'table']).toContain(e.family);
    }
  });

  it('每个工件有 nodes 且非空', () => {
    for (const e of EXPANDED_GOLDEN) {
      expect(e.artifact.nodes.length).toBeGreaterThan(0);
    }
  });
});
