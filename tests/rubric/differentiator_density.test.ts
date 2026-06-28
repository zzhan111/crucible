import { describe, it, expect } from 'vitest';
import { differentiatorDensity } from '../../src/rubric/differentiator_density.js';
import type { Artifact } from '../../src/predicates/types.js';

function table(nodes: Array<Record<string, unknown>>): Artifact {
  return { family: 'table', metadata: { day: 1 }, nodes };
}

describe('P4.6 §2 differentiator_density rubric', () => {
  it('全部 feature 具体(≥8 字符)→ 1.0', () => {
    const a = table([
      { competitor_name: 'A', feature: 'AI 自动评分 + 迭代', pricing: '¥1', source: 's', source_trust: 0.7, last_verified: '2026-06-01' },
      { competitor_name: 'B', feature: '多 agent 协作编排', pricing: '¥2', source: 's', source_trust: 0.7, last_verified: '2026-06-01' },
    ]);
    const r = differentiatorDensity(a);
    expect(r.dim).toBe('differentiator_density');
    expect(r.mode).toBe('deterministic');
    expect(r.score).toBe(1.0);
  });

  it('feature 空泛(<8 字符或空)→ 按占比给分', () => {
    const a = table([
      { competitor_name: 'A', feature: 'AI 自动评分 + 迭代', pricing: '¥1', source: 's', source_trust: 0.7, last_verified: '2026-06-01' },
      { competitor_name: 'B', feature: '工具', pricing: '¥2', source: 's', source_trust: 0.7, last_verified: '2026-06-01' }, // 2 字 < 8
      { competitor_name: 'C', feature: '', pricing: '¥3', source: 's', source_trust: 0.7, last_verified: '2026-06-01' }, // 空
    ]);
    const r = differentiatorDensity(a);
    expect(r.score).toBeCloseTo(1 / 3, 2);
    expect(r.rationale).toContain('1/3');
  });

  it('空表 → 0', () => {
    const a = table([]);
    const r = differentiatorDensity(a);
    expect(r.score).toBe(0);
    expect(r.rationale).toBe('empty table');
  });
});
