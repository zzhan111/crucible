import { describe, it, expect } from 'vitest';
import { sourceTrustFloor } from '../../src/predicates/source_trust_floor.js';
import type { Artifact } from '../../src/predicates/types.js';

function table(nodes: Array<Record<string, unknown>>): Artifact {
  return { family: 'table', metadata: { day: 1 }, nodes };
}

describe('P4.6 §1 source_trust_floor 谓词', () => {
  it('可信来源(≥0.4)→ 无违规', () => {
    const a = table([
      { competitor_name: 'A', pricing: '¥1', source: '官网', source_trust: 0.9, last_verified: '2026-06-01' },
      { competitor_name: 'B', pricing: '¥2', source: '论坛', source_trust: 0.5, last_verified: '2026-06-01' },
    ]);
    expect(sourceTrustFloor(a)).toEqual([]);
  });

  it('硬地板(<0.2)→ hard 违规', () => {
    const a = table([
      { competitor_name: 'A', pricing: '¥1', source: '匿名截图', source_trust: 0.1, last_verified: '2026-06-01' },
    ]);
    const v = sourceTrustFloor(a);
    expect(v.length).toBe(1);
    expect(v[0].severity).toBe('hard');
    expect(v[0].message).toContain('0.1');
    expect(v[0].message).toContain('0.2');
  });

  it('软地板(0.2-0.4 区间)→ soft 违规', () => {
    const a = table([
      { competitor_name: 'A', pricing: '¥1', source: '论坛帖', source_trust: 0.3, last_verified: '2026-06-01' },
    ]);
    const v = sourceTrustFloor(a);
    expect(v.length).toBe(1);
    expect(v[0].severity).toBe('soft');
    expect(v[0].message).toContain('待复核');
  });

  it('缺 source_trust 字段 → hard 违规(默认 0.0 < 硬地板)', () => {
    const a = table([
      { competitor_name: 'A', pricing: '¥1', source: 's', last_verified: '2026-06-01' },
    ]);
    const v = sourceTrustFloor(a);
    expect(v.length).toBe(1);
    expect(v[0].severity).toBe('hard');
    expect(v[0].message).toContain('缺 source_trust');
  });
});
