import { describe, it, expect } from 'vitest';
import { generateHtml } from '../../src/demo-html.js';
import type { Artifact } from '../../src/predicates/types.js';

describe('P2 §2.4 UI 路演可视化', () => {
  // 构造测试用的 HtmlData(降级模式数据)
  const mockData = {
    hasApiKey: false,
    contract: {
      artifact_family: 'sequence' as const,
      fields: [{ name: 'action', type: 'string' as const, required: true }],
      hard_constraints: [{ id: 'continuity', type: 'declarative' as const, rule: 'test' }],
      rubric: [{ dim: 'routing', weight: 0.25, mode: 'proxy+judge' as const }],
      calibration: { frozen_golden_set: 'golden/hk-3day-v1.jsonl', metric: 'kendall_tau' as const },
    },
    goldenReport: { deterministic: { violations: [], rubric_scores: [], hard_violation_count: 0, deterministic_score: 0.9 }, judge: null, final_score: 0.92 },
    buggyReport: {
      deterministic: {
        violations: [
          { constraint_id: 'continuity', severity: 'hard' as const, message: 'gap at 0-1', location: { node_index: 0 }, fix_hint: 'insert transit' },
          { constraint_id: 'state_mutex', severity: 'hard' as const, message: 'mutex at 0', location: { node_index: 0 }, fix_hint: 'remove token' },
        ],
        rubric_scores: [], hard_violation_count: 2, deterministic_score: 0.7,
      },
      judge: null, final_score: 0.75,
    },
    result: {
      iterations: [
        { artifact: { family: 'sequence', nodes: [] } as Artifact, score: 0.75, violations: 2, patchesApplied: 2 },
        { artifact: { family: 'sequence', nodes: [] } as Artifact, score: 0.92, violations: 0, patchesApplied: 0 },
      ],
      finalArtifact: { family: 'sequence', nodes: [] } as Artifact,
      finalScore: 0.92, proposals: 1,
    },
    scores: [0.75, 0.92],
    labels: ['v1', 'v2'],
    calibTau: 0.6429,
    calibVerdict: 'pass',
    calibPerDim: { routing: 0.5, memorability: 0.64, dining_fit: 0.43 },
    calibJudgeRanking: ['hk-a', 'yn-a', 'fc-a'],
    calibHumanRanking: ['fc-a', 'hk-a', 'yn-a'],
    evolvedContract: {
      artifact_family: 'sequence' as const,
      fields: [{ name: 'action', type: 'string' as const, required: true }],
      hard_constraints: [{ id: 'continuity', type: 'declarative' as const, rule: 'test' }, { id: 'beach_hiking_mutex', type: 'declarative' as const, mutex: ['beach', 'hiking'] }],
      rubric: [{ dim: 'routing', weight: 0.25, mode: 'proxy+judge' as const }],
      calibration: { frozen_golden_set: 'golden/hk-3day-v1.jsonl', metric: 'kendall_tau' as const },
      metadata: { version: 2 },
    } as any,
    version_bumped: true,
    abResult: { champion_tau: 0.5, challenger_tau: 0.55, tau_delta: 0.05, verdict: 'promote' as const, champion_ranking: [], challenger_ranking: [], human_ranking: [] },
    intelBuggyReport: { deterministic: { violations: [], rubric_scores: [], hard_violation_count: 3, deterministic_score: 0.55 }, judge: null, final_score: 0.55 },
    intelGoldenReport: { deterministic: { violations: [], rubric_scores: [], hard_violation_count: 0, deterministic_score: 1.0 }, judge: null, final_score: 1.0 },
    crossFamilyGo: true,
  };

  it('generateHtml 返回非空 HTML 字符串', () => {
    const html = generateHtml(mockData);
    expect(html).toContain('<!DOCTYPE html>');
    expect(html.length).toBeGreaterThan(500);
  });

  it('HTML 含 5 段标题', () => {
    const html = generateHtml(mockData);
    expect(html).toContain('契约 + Judge 校准');
    expect(html).toContain('跑分抓 Bug');
    expect(html).toContain('契约自演化');
    expect(html).toContain('Champion-Challenger A/B');
    expect(html).toContain('跨族探针');
  });

  it('HTML 含 SVG 图表(分数曲线 + A/B 柱状图)', () => {
    const html = generateHtml(mockData);
    expect(html).toContain('<svg');
    expect(html).toContain('polyline'); // 分数曲线
  });

  it('HTML 含 go/no-go 徽章', () => {
    const html = generateHtml(mockData);
    expect(html).toMatch(/GO|NO-GO/);
  });

  it('HTML 含分数值', () => {
    const html = generateHtml(mockData);
    expect(html).toContain('0.92');
  });

  it('HTML 含校准 τ 值', () => {
    const html = generateHtml(mockData);
    expect(html).toContain('0.6429');
    expect(html).toContain('PASS');
  });

  it('HTML 含违规卡片', () => {
    const html = generateHtml(mockData);
    expect(html).toContain('continuity');
    expect(html).toContain('state_mutex');
  });

  it('HTML 含 A/B 判定', () => {
    const html = generateHtml(mockData);
    expect(html).toContain('PROMOTE');
  });
});
