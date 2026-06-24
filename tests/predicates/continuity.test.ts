import { describe, it, expect } from 'vitest';
import { continuity } from '../../src/predicates/continuity.js';
import type { Artifact } from '../../src/predicates/types.js';

describe('continuity', () => {
  it('passes when adjacent non-transit nodes have transit between them', () => {
    const artifact: Artifact = {
      family: 'sequence',
      nodes: [
        { node_type: 'dining', action: 'breakfast' },
        { node_type: 'transit', action: 'walk to mtr' },
        { node_type: 'core_experience', action: 'hike dragons back' },
      ],
    };
    expect(continuity(artifact)).toEqual([]);
  });

  it('flags when two non-transit nodes are adjacent without a transit/switch', () => {
    const artifact: Artifact = {
      family: 'sequence',
      nodes: [
        { node_type: 'dining', action: 'breakfast' },
        { node_type: 'core_experience', action: 'hike' },
      ],
    };
    const violations = continuity(artifact);
    expect(violations).toHaveLength(1);
    expect(violations[0].constraint_id).toBe('continuity');
    expect(violations[0].location.node_index).toBe(0);
    expect(violations[0].location.node_index_end).toBe(1);
    expect(violations[0].fix_hint).toMatch(/transit|switch/i);
  });

  it('does not flag adjacent transit nodes', () => {
    const artifact: Artifact = {
      family: 'sequence',
      nodes: [
        { node_type: 'transit', action: 'walk' },
        { node_type: 'transit', action: 'mtr' },
      ],
    };
    expect(continuity(artifact)).toEqual([]);
  });

  it('handles empty and single-node artifacts', () => {
    expect(continuity({ family: 'sequence', nodes: [] })).toEqual([]);
    expect(continuity({ family: 'sequence', nodes: [{ node_type: 'hard' }] })).toEqual([]);
  });

  it('flags multiple gaps', () => {
    const artifact: Artifact = {
      family: 'sequence',
      nodes: [
        { node_type: 'dining' },
        { node_type: 'core_experience' },
        { node_type: 'transit' },
        { node_type: 'dining' },
        { node_type: 'checkin' },
      ],
    };
    expect(continuity(artifact)).toHaveLength(2);
  });
});
