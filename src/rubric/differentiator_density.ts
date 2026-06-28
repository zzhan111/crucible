import type { Artifact } from '../predicates/types.js';
import type { RubricScore, DeterministicRubric } from './types.js';

/**
 * differentiatorDensity (P4.6 §2):差异点密度。
 *
 * 监测场景下"feature 字段"承载竞品的差异化卖点。
 * 度量:feature 非空且长度 ≥ 8 字符(够具体,非"工具"/"平台"等空泛词)的行占比。
 *
 * 阈值 8 字符:经验值——"AI 评分"(4字)太泛,"AI 自动评分 + 迭代"(10字)才具体。
 * 太长的 feature 也不一定好,但本 rubric 只看"是否够具体",深度由 strategic_insight judge 评。
 *
 * 适用于 table 族(情报表)。
 */
const MIN_FEATURE_LEN = 8;

export const differentiatorDensity: DeterministicRubric = (artifact: Artifact): RubricScore => {
  const nodes = artifact.nodes;
  if (nodes.length === 0) return { dim: 'differentiator_density', score: 0, mode: 'deterministic', rationale: 'empty table' };

  let specificCount = 0;
  for (const n of nodes) {
    const f = n.feature;
    if (f === undefined || f === null) continue;
    const s = String(f).trim();
    if (s.length >= MIN_FEATURE_LEN) specificCount++;
  }
  const score = specificCount / nodes.length;
  return {
    dim: 'differentiator_density',
    score,
    mode: 'deterministic',
    rationale: `${specificCount}/${nodes.length} rows have specific feature (≥${MIN_FEATURE_LEN} chars)`,
  };
};
