import { describe, it, expect } from 'vitest';
import { stalePricing, makeStalePricing } from '../../src/predicates/stale_pricing.js';
import type { Artifact } from '../../src/predicates/types.js';

/** 参考日期 2026-06-25(freshness.ts 同值);180 天阈值 = 2025-12-27 之前为陈旧 */
function table(nodes: Array<Record<string, unknown>>): Artifact {
  return { family: 'table', metadata: { day: 1 }, nodes };
}

describe('P4.6 §1 stale_pricing 谓词', () => {
  it('新鲜定价(30 天内)→ 无违规', () => {
    const a = table([
      { competitor_name: 'A', pricing: '¥1', source: 's', source_trust: 0.7, last_verified: '2026-06-01' },
    ]);
    expect(stalePricing(a)).toEqual([]);
  });

  it('陈旧定价(超 180 天)→ hard 违规,含天数信息', () => {
    const a = table([
      { competitor_name: 'A', pricing: '¥1', source: 's', source_trust: 0.7, last_verified: '2025-09-01' },
    ]);
    const v = stalePricing(a);
    expect(v.length).toBe(1);
    expect(v[0].severity).toBe('hard');
    expect(v[0].constraint_id).toBe('stale_pricing');
    expect(v[0].message).toContain('陈旧');
    expect(v[0].message).toMatch(/\d+天/);
    expect(v[0].location.node_index).toBe(0);
  });

  it('恰好在阈值边界(180 天)→ 无违规(> 才触发)', () => {
    // 2025-12-27 距 2026-06-25 = 180 天,不超阈值
    const a = table([
      { competitor_name: 'A', pricing: '¥1', source: 's', source_trust: 0.7, last_verified: '2025-12-27' },
    ]);
    expect(stalePricing(a)).toEqual([]);
  });

  it('自定义阈值(90 天)→ 更严格,90-180 天区间也触发', () => {
    const strict = makeStalePricing(90);
    // 2026-03-01 距 2026-06-25 ≈ 116 天,超 90 但不超 180
    const a = table([
      { competitor_name: 'A', pricing: '¥1', source: 's', source_trust: 0.7, last_verified: '2026-03-01' },
    ]);
    expect(strict(a).length).toBe(1);
    expect(stalePricing(a)).toEqual([]); // 默认 180 不触发
  });

  it('缺 last_verified / 无法解析日期 → 跳过(不报本约束)', () => {
    const a = table([
      { competitor_name: 'A', pricing: '¥1', source: 's', source_trust: 0.7 }, // 缺 last_verified
      { competitor_name: 'B', pricing: '¥2', source: 's', source_trust: 0.7, last_verified: 'not-a-date' },
    ]);
    expect(stalePricing(a)).toEqual([]);
  });
});
