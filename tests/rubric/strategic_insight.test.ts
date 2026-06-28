import { describe, it, expect } from 'vitest';
import { strategicInsightJudge } from '../../src/rubric/strategic_insight.judge.js';
import type { Artifact } from '../../src/predicates/types.js';
import type { JudgeContext } from '../../src/rubric/judge-types.js';

function table(nodes: Array<Record<string, unknown>>): Artifact {
  return { family: 'table', metadata: { day: 1 }, nodes };
}

function ctx(art: Artifact): JudgeContext {
  return { artifact: art, dim: 'strategic_insight', weight: 0.2 };
}

describe('P4.6 §2 strategic_insight judge (mock fallback)', () => {
  // 无 OPENAI_API_KEY 时走 mock fallback(测试环境默认无 key)
  const hasKey = !!process.env.OPENAI_API_KEY;

  it('返回 RubricScore,dim=strategic_insight, mode=judge', async () => {
    const a = table([
      { competitor_name: 'A', feature: 'AI 自动评分', pricing: '¥1', source_trust: 0.7, last_verified: '2026-06-01' },
      { competitor_name: 'B', feature: '多 agent', pricing: '¥2', source_trust: 0.7, last_verified: '2026-06-01' },
    ]);
    const r = await strategicInsightJudge(ctx(a));
    expect(r.dim).toBe('strategic_insight');
    expect(r.mode).toBe('judge');
    expect(r.score).toBeGreaterThanOrEqual(0);
    expect(r.score).toBeLessThanOrEqual(1);
  });

  it('mock fallback:分值随竞品数增加(差异化体现)', async () => {
    if (hasKey) return; // 有 key 时跳过 mock 行为断言
    const two = table([
      { competitor_name: 'A', feature: 'f', pricing: '¥1', source_trust: 0.7, last_verified: '2026-06-01' },
      { competitor_name: 'B', feature: 'f', pricing: '¥1', source_trust: 0.7, last_verified: '2026-06-01' },
    ]);
    const four = table([
      { competitor_name: 'A', feature: 'f', pricing: '¥1', source_trust: 0.7, last_verified: '2026-06-01' },
      { competitor_name: 'B', feature: 'f', pricing: '¥1', source_trust: 0.7, last_verified: '2026-06-01' },
      { competitor_name: 'C', feature: 'f', pricing: '¥1', source_trust: 0.7, last_verified: '2026-06-01' },
      { competitor_name: 'D', feature: 'f', pricing: '¥1', source_trust: 0.7, last_verified: '2026-06-01' },
    ]);
    const s2 = (await strategicInsightJudge(ctx(two))).score;
    const s4 = (await strategicInsightJudge(ctx(four))).score;
    expect(s4).toBeGreaterThan(s2);
  });

  it('mock fallback:rationale 标注 "mock fallback" + 竞品数', async () => {
    if (hasKey) return;
    const a = table([
      { competitor_name: 'A', feature: 'f', pricing: '¥1', source_trust: 0.7, last_verified: '2026-06-01' },
      { competitor_name: 'B', feature: 'f', pricing: '¥1', source_trust: 0.7, last_verified: '2026-06-01' },
    ]);
    const r = await strategicInsightJudge(ctx(a));
    expect(r.rationale).toContain('mock fallback');
    expect(r.rationale).toContain('2 competitors');
  });

  it('mock fallback:分值在 [0.4, 0.85] 区间(诚实降级,不固定 0.5)', async () => {
    if (hasKey) return;
    const a = table([
      { competitor_name: 'A', feature: 'f', pricing: '¥1', source_trust: 0.7, last_verified: '2026-06-01' },
    ]);
    const r = await strategicInsightJudge(ctx(a));
    expect(r.score).toBeGreaterThanOrEqual(0.4);
    expect(r.score).toBeLessThanOrEqual(0.85);
  });
});
