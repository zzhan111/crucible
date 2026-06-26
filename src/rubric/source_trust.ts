import type { Artifact } from '../predicates/types.js';
import type { DeterministicRubric, RubricScore } from './types.js';

/**
 * sourceTrust (deterministic): 节点 source_trust 字段(0.0-1.0)等权平均。
 * 无 source_trust 字段按 0.0 计。空 artifact 返回 0.5(中性,无证据≠坏)。
 */
export const sourceTrust: DeterministicRubric = (artifact: Artifact): RubricScore => {
  const nodes = artifact.nodes;
  if (nodes.length === 0) {
    return { dim: 'source_trust', score: 0.5, mode: 'deterministic', rationale: 'empty artifact (neutral)' };
  }
  let sum = 0;
  let withTrust = 0;
  for (const node of nodes) {
    const t = node.source_trust;
    if (typeof t === 'number' && !Number.isNaN(t)) {
      sum += t;
      withTrust++;
    }
  }
  const score = sum / nodes.length; // 缺失字段按 0.0,故分母是全部节点数
  return {
    dim: 'source_trust',
    score,
    mode: 'deterministic',
    rationale: `${withTrust}/${nodes.length} nodes carry source_trust; weighted avg = ${score.toFixed(3)}`,
  };
};
