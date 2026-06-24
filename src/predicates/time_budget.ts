import type { Artifact, Predicate, Violation } from './types.js';

const DEFAULT_DAILY_MINUTES = 960;

/**
 * timeBudget: 单日 duration_min 之和 ≤ daily_available_minutes。
 * P0 假设整个 artifact 是单日。多日拆分留 P1。
 */
export const timeBudget: Predicate = (artifact: Artifact): Violation[] => {
  const limit = artifact.metadata?.daily_available_minutes ?? DEFAULT_DAILY_MINUTES;
  let sum = 0;
  for (const node of artifact.nodes) {
    const d = node.duration_min;
    if (typeof d === 'number' && !Number.isNaN(d)) sum += d;
  }
  if (sum <= limit) return [];
  return [{
    constraint_id: 'time_budget',
    severity: 'hard',
    message: `total duration ${sum} min exceeds daily budget ${limit} min`,
    location: { field: 'duration_min' },
    fix_hint: `reduce total duration by ${sum - limit} min, or raise daily_available_minutes`,
  }];
};
