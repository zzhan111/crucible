import { describe, it, expect } from 'vitest';
import { sourceTrust } from '../../src/rubric/source_trust.js';
import type { Artifact } from '../../src/predicates/types.js';

describe('sourceTrust', () => {
  it('returns average of source_trust values', () => {
    const artifact: Artifact = {
      family: 'sequence',
      nodes: [
        { source_trust: 0.8 },
        { source_trust: 0.6 },
      ],
    };
    const r = sourceTrust(artifact);
    expect(r.dim).toBe('source_trust');
    expect(r.mode).toBe('deterministic');
    expect(r.score).toBeCloseTo(0.7, 3);
  });

  it('treats missing source_trust as 0.0', () => {
    const artifact: Artifact = {
      family: 'sequence',
      nodes: [
        { source_trust: 1.0 },
        { action: 'no trust field' },
      ],
    };
    const r = sourceTrust(artifact);
    expect(r.score).toBeCloseTo(0.5, 3);
  });

  it('returns 0.0 when all nodes lack source_trust', () => {
    const artifact: Artifact = {
      family: 'sequence',
      nodes: [{ action: 'a' }, { action: 'b' }],
    };
    const r = sourceTrust(artifact);
    expect(r.score).toBe(0.0);
    expect(r.rationale).toMatch(/0\/2 nodes/);
  });

  it('handles empty artifact (neutral 0.5)', () => {
    const r = sourceTrust({ family: 'sequence', nodes: [] });
    expect(r.score).toBe(0.5); // P1: 空 artifact 无证据 ≠ 坏 → 中性 0.5
  });

  it('returns 1.0 when all nodes have source_trust 1.0', () => {
    const artifact: Artifact = {
      family: 'sequence',
      nodes: [{ source_trust: 1.0 }, { source_trust: 1.0 }],
    };
    expect(sourceTrust(artifact).score).toBe(1.0);
  });
});
