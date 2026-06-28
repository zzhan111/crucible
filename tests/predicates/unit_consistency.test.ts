import { describe, it, expect } from 'vitest';
import { unitConsistency } from '../../src/predicates/unit_consistency.js';
import type { Artifact } from '../../src/predicates/types.js';

function table(nodes: Array<Record<string, unknown>>): Artifact {
  return { family: 'table', metadata: { day: 1 }, nodes };
}

describe('P4.6 §1 unit_consistency 谓词', () => {
  it('规范单位(¥/月、$/mo、/年、免费、按量)→ 无违规', () => {
    const a = table([
      { competitor_name: 'A', pricing: '¥299/月', source: 's', source_trust: 0.7, last_verified: '2026-06-01' },
      { competitor_name: 'B', pricing: '$49/mo', source: 's', source_trust: 0.7, last_verified: '2026-06-01' },
      { competitor_name: 'C', pricing: '¥1200/年', source: 's', source_trust: 0.7, last_verified: '2026-06-01' },
      { competitor_name: 'D', pricing: '免费', source: 's', source_trust: 0.7, last_verified: '2026-06-01' },
      { competitor_name: 'E', pricing: '¥0.5/次(按量)', source: 's', source_trust: 0.7, last_verified: '2026-06-01' },
    ]);
    expect(unitConsistency(a)).toEqual([]);
  });

  it('裸数字无单位(如 "299")→ soft 违规', () => {
    const a = table([
      { competitor_name: 'A', pricing: '299', source: 's', source_trust: 0.7, last_verified: '2026-06-01' },
    ]);
    const v = unitConsistency(a);
    expect(v.length).toBe(1);
    expect(v[0].severity).toBe('soft');
    expect(v[0].message).toContain('单位不可归一化');
  });

  it('文本描述无单位(如 "面议")→ soft 违规', () => {
    const a = table([
      { competitor_name: 'A', pricing: '面议', source: 's', source_trust: 0.7, last_verified: '2026-06-01' },
    ]);
    expect(unitConsistency(a).length).toBe(1);
  });

  it('缺 pricing / pricing_format 已判无效词 → 跳过(不重复报)', () => {
    const a = table([
      { competitor_name: 'A', source: 's', source_trust: 0.7, last_verified: '2026-06-01' }, // 缺 pricing
      { competitor_name: 'B', pricing: '未知', source: 's', source_trust: 0.7, last_verified: '2026-06-01' }, // pricing_format 词
    ]);
    expect(unitConsistency(a)).toEqual([]);
  });

  it('混用单位但都规范 → 无违规(可归一化即合规,不要求单位一致)', () => {
    const a = table([
      { competitor_name: 'A', pricing: '¥299/月', source: 's', source_trust: 0.7, last_verified: '2026-06-01' },
      { competitor_name: 'B', pricing: '¥2990/年', source: 's', source_trust: 0.7, last_verified: '2026-06-01' },
    ]);
    expect(unitConsistency(a)).toEqual([]);
  });
});
