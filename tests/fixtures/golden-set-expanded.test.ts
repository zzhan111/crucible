import { describe, it, expect } from 'vitest';
import {
  EXPANDED_GOLDEN,
  CALIBRATION_GOLDEN,
  DETECTION_GOLDEN,
  type ExpandedGoldenEntry,
} from '../../src/fixtures/golden-set-expanded.js';
import { GOLDEN_ARTIFACTS } from '../../src/fixtures/golden-set.js';
import { computeGoldenStats, computeFieldStats } from '../../src/curator/novelty_v2.js';
import { loadContract } from '../../src/contract/validate.js';
import { compileContract } from '../../src/contract/compiler.js';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TABLE_CONTRACT = join(__dirname, '..', '..', 'contracts', 'intel-table-v1.yaml');

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
    const patterns = ['time_budget', 'state_mutex', 'duplicate_state', 'continuity', 'missing_source', 'pricing_format', 'duplicate_competitor', 'stale_pricing', 'trust_floor'];
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
      expect(['sequence', 'table', 'financial']).toContain(e.family);
    }
  });

  it('每个工件有 nodes 且非空', () => {
    for (const e of EXPANDED_GOLDEN) {
      expect(e.artifact.nodes.length).toBeGreaterThan(0);
    }
  });
});

describe('P4.5 黄金集 table 族梯度补全', () => {
  it('EXPANDED_GOLDEN 含新增 3 个 table calibration 工件(总数随 P4.3 financial 增长)', () => {
    const ids = EXPANDED_GOLDEN.map(e => e.id);
    expect(ids).toContain('intel-high2');
    expect(ids).toContain('intel-mid2');
    expect(ids).toContain('intel-low2');
    // P4.5 后 23;P4.3 加 9 financial(6 calib + 3 det)= 32;P4.6 加 5 intel(3 calib + 2 det)= 37
    expect(EXPANDED_GOLDEN.length).toBe(37);
  });

  it('table calibration 每个 tier ≥ 2(审计 cell 不再告警)', () => {
    const tableCalib = EXPANDED_GOLDEN.filter(
      e => e.family === 'table' && e.purpose === 'calibration'
    );
    for (const tier of ['high', 'mid', 'low'] as const) {
      const count = tableCalib.filter(e => e.quality_tier === tier).length;
      expect(count, `table/${tier} 应 ≥ 2`).toBeGreaterThanOrEqual(2);
    }
  });

  it('3 个新工件均无硬违规(governance §3.1:calibration 工件只能 judge 维度差异)', () => {
    const contract = loadContract(TABLE_CONTRACT);
    const scorer = compileContract(contract);
    for (const id of ['intel-high2', 'intel-mid2', 'intel-low2']) {
      const entry = EXPANDED_GOLDEN.find(e => e.id === id)!;
      const report = scorer.score(entry.artifact);
      expect(report.deterministic.hard_violation_count, `${id} 不应有硬违规`).toBe(0);
    }
  });

  it('新工件数据与现有不重复(competitor_name 各异,避免 duplicate_competitor)', () => {
    const newEntries = ['intel-high2', 'intel-mid2', 'intel-low2']
      .map(id => EXPANDED_GOLDEN.find(e => e.id === id)!)
      .flatMap(e => e.artifact.nodes.map(n => (n as { competitor_name: string }).competitor_name));
    const oldEntries = ['intel-high', 'intel-mid', 'intel-low']
      .map(id => EXPANDED_GOLDEN.find(e => e.id === id)!)
      .flatMap(e => e.artifact.nodes.map(n => (n as { competitor_name: string }).competitor_name));
    // 新旧竞品名不重叠(避免数据雷同)
    for (const name of newEntries) {
      expect(oldEntries).not.toContain(name);
    }
    // 新工件内部无重复竞品名
    expect(new Set(newEntries).size).toBe(newEntries.length);
  });

  it('CALIBRATION_GOLDEN 数量同步增长(P4.5 + P4.3 financial + P4.6 intel)', () => {
    // P4.5: 13→16(table +3); P4.3: 16→22(financial +6 calibration); P4.6: 22→25(intel +3 calibration)
    expect(CALIBRATION_GOLDEN.length).toBe(25);
  });
});

describe('P4.6 intel 深化:公开快照 + 新 detection 探针', () => {
  it('EXPANDED_GOLDEN 含 3 个公开快照 calibration + 2 个新 detection', () => {
    const ids = EXPANDED_GOLDEN.map(e => e.id);
    expect(ids).toContain('intel-pub-saas');
    expect(ids).toContain('intel-pub-oss');
    expect(ids).toContain('intel-pub-oss-low');
    expect(ids).toContain('vio-stale-pricing');
    expect(ids).toContain('vio-trust-floor');
  });

  it('3 个公开快照 calibration 无硬违规(v1.1 契约:含 stale_pricing / source_trust_floor)', () => {
    const contract = loadContract(TABLE_CONTRACT);
    const scorer = compileContract(contract);
    for (const id of ['intel-pub-saas', 'intel-pub-oss', 'intel-pub-oss-low']) {
      const entry = EXPANDED_GOLDEN.find(e => e.id === id)!;
      const report = scorer.score(entry.artifact);
      expect(report.deterministic.hard_violation_count, `${id} 不应有硬违规`).toBe(0);
    }
  });

  it('vio-stale-pricing 触发 stale_pricing hard 违规(全部超 180 天)', () => {
    const contract = loadContract(TABLE_CONTRACT);
    const scorer = compileContract(contract);
    const entry = EXPANDED_GOLDEN.find(e => e.id === 'vio-stale-pricing')!;
    const report = scorer.score(entry.artifact);
    const v = report.deterministic.violations.find(x => x.constraint_id === 'stale_pricing');
    expect(v).toBeDefined();
    expect(v!.severity).toBe('hard');
    expect(report.deterministic.hard_violation_count).toBeGreaterThanOrEqual(1);
  });

  it('vio-trust-floor 触发 source_trust_floor hard 违规(全部 < 0.2)', () => {
    const contract = loadContract(TABLE_CONTRACT);
    const scorer = compileContract(contract);
    const entry = EXPANDED_GOLDEN.find(e => e.id === 'vio-trust-floor')!;
    const report = scorer.score(entry.artifact);
    const v = report.deterministic.violations.find(x => x.constraint_id === 'source_trust_floor');
    expect(v).toBeDefined();
    expect(v!.severity).toBe('hard');
    expect(report.deterministic.hard_violation_count).toBeGreaterThanOrEqual(1);
  });

  it('公开快照竞品名与既有 intel 不重复(避免 duplicate_competitor)', () => {
    const pubNames = ['intel-pub-saas', 'intel-pub-oss', 'intel-pub-oss-low']
      .map(id => EXPANDED_GOLDEN.find(e => e.id === id)!)
      .flatMap(e => e.artifact.nodes.map(n => (n as { competitor_name: string }).competitor_name));
    const oldNames = ['intel-high', 'intel-mid', 'intel-low', 'intel-high2', 'intel-mid2', 'intel-low2']
      .map(id => EXPANDED_GOLDEN.find(e => e.id === id)!)
      .flatMap(e => e.artifact.nodes.map(n => (n as { competitor_name: string }).competitor_name));
    for (const name of pubNames) {
      expect(oldNames).not.toContain(name);
    }
    expect(new Set(pubNames).size).toBe(pubNames.length);
  });
});

describe('P4.3 财务尽调 vertical 黄金集条目', () => {
  it('EXPANDED_GOLDEN 含 financial 族条目', () => {
    const fin = EXPANDED_GOLDEN.filter(e => e.family === 'financial');
    expect(fin.length).toBeGreaterThanOrEqual(6); // 6 calibration + 3 detection = 9, 至少 6
    const ids = fin.map(e => e.id);
    expect(ids).toContain('fin-high');
    expect(ids).toContain('vio-tax-ratio');
  });

  it('financial calibration 每个 tier ≥ 2(审计 cell 不告警)', () => {
    const finCalib = EXPANDED_GOLDEN.filter(e => e.family === 'financial' && e.purpose === 'calibration');
    for (const tier of ['high', 'mid', 'low'] as const) {
      const count = finCalib.filter(e => e.quality_tier === tier).length;
      expect(count, `financial/${tier} 应 ≥ 2`).toBeGreaterThanOrEqual(2);
    }
  });

  it('financial detection 条目覆盖 3 个红旗 pattern', () => {
    const finDet = EXPANDED_GOLDEN.filter(e => e.family === 'financial' && e.purpose === 'detection');
    const patterns = finDet.map(e => e.violation);
    expect(patterns).toContain('tax_ratio_low');
    expect(patterns).toContain('cashflow_anomaly');
    expect(patterns).toContain('related_party_transfer');
  });

  it('financial calibration 工件无硬违规(governance §3.1)', () => {
    const scorer = compileContract(loadContract(TABLE_CONTRACT));
    // financial 用 financial-v1 契约,不是 intel-table;此测试验 financial calibration 工件
    // 用 financial-v1 重打分验无硬违规
    const finContract = loadContract(join(__dirname, '..', '..', 'contracts', 'financial-v1.yaml'));
    const finScorer = compileContract(finContract);
    const finCalib = EXPANDED_GOLDEN.filter(e => e.family === 'financial' && e.purpose === 'calibration');
    for (const e of finCalib) {
      const r = finScorer.score(e.artifact);
      expect(r.deterministic.hard_violation_count, `${e.id} 不应有硬违规`).toBe(0);
    }
  });
});
