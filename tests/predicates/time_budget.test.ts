import { describe, it, expect } from 'vitest';
import { timeBudget } from '../../src/predicates/time_budget.js';
import type { Artifact } from '../../src/predicates/types.js';

describe('timeBudget', () => {
  it('passes when sum under default 960 min', () => {
    const artifact: Artifact = {
      family: 'sequence',
      nodes: [
        { duration_min: 30 },
        { duration_min: 120 },
        { duration_min: 60 },
      ],
    };
    expect(timeBudget(artifact)).toEqual([]);
  });

  it('flags when sum exceeds default 960 min', () => {
    const artifact: Artifact = {
      family: 'sequence',
      nodes: [
        { duration_min: 500 },
        { duration_min: 500 },
      ],
    };
    const v = timeBudget(artifact);
    expect(v).toHaveLength(1);
    expect(v[0].constraint_id).toBe('time_budget');
    expect(v[0].message).toMatch(/1000/);
    expect(v[0].message).toMatch(/960/);
  });

  it('respects metadata.daily_available_minutes override', () => {
    const artifact: Artifact = {
      family: 'sequence',
      metadata: { daily_available_minutes: 600 },
      nodes: [{ duration_min: 700 }],
    };
    expect(timeBudget(artifact)).toHaveLength(1);
  });

  it('skips nodes without duration_min', () => {
    const artifact: Artifact = {
      family: 'sequence',
      nodes: [{ action: 'x' }, { duration_min: 500 }],
    };
    expect(timeBudget(artifact)).toEqual([]);
  });

  it('handles zero-duration edge case', () => {
    const artifact: Artifact = {
      family: 'sequence',
      nodes: [{ duration_min: 0 }, { duration_min: 0 }],
    };
    expect(timeBudget(artifact)).toEqual([]);
  });
});
