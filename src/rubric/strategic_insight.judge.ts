import type { JudgeRubric, JudgeContext } from './judge-types.js';
import { parseJudgeScore } from './judge-types.js';
import { callLLM } from '../llm/client.js';
import { hasApiKey } from '../llm/client.js';

/**
 * strategicInsightJudge (P4.6 §2):战略洞察质量(LLM judge,带 mock fallback)。
 *
 * 评估竞品情报表的"洞察是否实质性":
 *   - 差异点是否真实可比较(而非营销话术)
 *   - 比较维度是否公平(对等比较,非苹果比橘子)
 *   - 是否能支撑采购/选型决策
 *
 * 无 LLM key 时降级(mock fallback):基于 coverage 的确定性近似。
 *   逻辑:coverage 高(行完整)+ 不同 competitor_name 多 → 洞察更可能实质性。
 *   分数 = clamp(0.4 + 0.1*(uniqueCompetitors-1) + 0.1*coverageRatio, 0.4, 0.85)。
 *   这样无 key 时仍有区分度(不固定 0.5,体现 mock 的"诚实降级")。
 *
 * 适用于 table 族(情报表)。
 */
export const strategicInsightJudge: JudgeRubric = async (ctx: JudgeContext) => {
  const nodes = ctx.artifact.nodes;
  const competitors = nodes.map(n => n.competitor_name).filter(Boolean);
  const uniqueCompetitors = new Set(competitors.map(String)).size;
  const completeRows = nodes.filter(n =>
    n.feature !== undefined && String(n.feature).trim() !== '' &&
    n.pricing !== undefined && String(n.pricing).trim() !== ''
  ).length;
  const coverageRatio = nodes.length > 0 ? completeRows / nodes.length : 0;

  // mock fallback:无 API key 时基于结构特征给近似分
  if (!hasApiKey()) {
    const mockScore = Math.min(0.85, Math.max(0.4, 0.4 + 0.1 * (uniqueCompetitors - 1) + 0.1 * coverageRatio));
    return {
      dim: 'strategic_insight',
      score: Number(mockScore.toFixed(3)),
      mode: 'judge',
      rationale: `mock fallback (no API key): ${uniqueCompetitors} competitors, coverage ${coverageRatio.toFixed(2)} → ${mockScore.toFixed(3)}`,
    };
  }

  const prompt = `You are evaluating the strategic insight quality of a competitor intelligence table.
Competitor rows: ${JSON.stringify(nodes.map(n => ({ competitor: n.competitor_name, feature: n.feature, pricing: n.pricing })))}
Rate the strategic insight quality 0.0 to 1.0. Consider:
- Are differentiators concrete and comparable (not marketing fluff)?
- Is the comparison fair (apples-to-apples)?
- Does it support procurement/selection decisions?
Respond with only a number between 0 and 1.`;
  const raw = await callLLM(prompt);
  const score = parseJudgeScore(raw, 'strategic_insight');
  return {
    dim: 'strategic_insight',
    score,
    mode: 'judge',
    rationale: `judge=${raw ?? 'null(neutral)'} | ${uniqueCompetitors} competitors`,
  };
};
