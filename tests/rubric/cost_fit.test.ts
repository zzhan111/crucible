import { describe, it, expect } from 'vitest';
import { costFit } from '../../src/rubric/cost_fit.js';
import type { Artifact } from '../../src/predicates/types.js';

describe('costFit', () => {
  it('returns 1.0 when total cost is within budget', () => {
    const artifact: Artifact = {
      family: 'sequence',
      metadata: { budget: { min: 0, max: 1000 } },
      nodes: [{ cost: 200 }, { cost: 300 }],
    };
    const r = costFit(artifact);
    expect(r.dim).toBe('cost_fit');
    expect(r.mode).toBe('deterministic');
    expect(r.score).toBe(1.0);
  });

  it('returns linearly decaying score when over budget', () => {
    const artifact: Artifact = {
      family: 'sequence',
      metadata: { budget: { min: 0, max: 1000 } },
      nodes: [{ cost: 1500 }],
    };
    const r = costFit(artifact);
    expect(r.score).toBeCloseTo(1000 / 1500, 3);
    expect(r.rationale).toMatch(/over budget/i);
  });

  it('returns 0.5 neutral when no budget metadata', () => {
    const artifact: Artifact = {
      family: 'sequence',
      nodes: [{ cost: 100 }],
    };
    const r = costFit(artifact);
    expect(r.score).toBe(0.5);
    expect(r.rationale).toMatch(/no budget/i);
  });

  it('ignores nodes without cost', () => {
    const artifact: Artifact = {
      family: 'sequence',
      metadata: { budget: { min: 0, max: 500 } },
      nodes: [{ action: 'x' }, { cost: 400 }],
    };
    const r = costFit(artifact);
    expect(r.score).toBe(1.0);
  });

  it('handles zero total cost', () => {
    const artifact: Artifact = {
      family: 'sequence',
      metadata: { budget: { min: 0, max: 500 } },
      nodes: [{ cost: 0 }, { cost: 0 }],
    };
    const r = costFit(artifact);
    expect(r.score).toBe(1.0);
  });
});
