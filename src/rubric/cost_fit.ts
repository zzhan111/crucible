import type { Artifact } from '../predicates/types.js';
import type { DeterministicRubric, RubricScore } from './types.js';

/**
 * costFit (deterministic): 总 cost 在 budget.max 内 → 1.0;超 → max/actual 线性衰减;无 budget → 0.5 neutral。
 */
export const costFit: DeterministicRubric = (artifact: Artifact): RubricScore => {
  const budget = artifact.metadata?.budget;
  let total = 0;
  for (const node of artifact.nodes) {
    const c = node.cost;
    if (typeof c === 'number' && !Number.isNaN(c)) total += c;
  }
  if (!budget) {
    return {
      dim: 'cost_fit',
      score: 0.5,
      mode: 'deterministic',
      rationale: `no budget metadata; total cost ${total}; neutral 0.5`,
    };
  }
  if (total <= budget.max) {
    return {
      dim: 'cost_fit',
      score: 1.0,
      mode: 'deterministic',
      rationale: `total cost ${total} within budget [${budget.min}, ${budget.max}]`,
    };
  }
  const score = budget.max / total;
  return {
    dim: 'cost_fit',
    score,
    mode: 'deterministic',
    rationale: `total cost ${total} over budget max ${budget.max}; linear decay to ${score.toFixed(3)}`,
  };
};
