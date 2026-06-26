import type { Artifact } from '../predicates/types.js';
import type { RubricScore, DeterministicRubric } from './types.js';

/**
 * coverage (P1 §2.8 跨族探针):情报表覆盖率。
 * 度量:有 feature + pricing + source 的行占比(完整行比例)。
 * 适用于 table 族。
 */
export const coverage: DeterministicRubric = (artifact: Artifact): RubricScore => {
  const nodes = artifact.nodes;
  if (nodes.length === 0) return { dim: 'coverage', score: 0, mode: 'deterministic', rationale: 'empty table' };

  let completeRows = 0;
  for (const n of nodes) {
    const hasFeature = n.feature !== undefined && String(n.feature).trim() !== '';
    const hasPricing = n.pricing !== undefined && String(n.pricing).trim() !== '';
    const hasSource = n.source !== undefined && String(n.source).trim() !== '';
    if (hasFeature && hasPricing && hasSource) completeRows++;
  }
  const score = completeRows / nodes.length;
  return {
    dim: 'coverage',
    score,
    mode: 'deterministic',
    rationale: `${completeRows}/${nodes.length} rows complete`,
  };
};
