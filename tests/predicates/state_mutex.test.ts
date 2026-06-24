import { describe, it, expect } from 'vitest';
import { makeStateMutex } from '../../src/predicates/state_mutex.js';
import type { Artifact } from '../../src/predicates/types.js';

describe('state_mutex', () => {
  const predicate = makeStateMutex(['luggage_drop', 'depart_from_hotel']);

  it('passes when no state tokens', () => {
    const artifact: Artifact = {
      family: 'sequence',
      nodes: [{ action: 'breakfast' }, { action: 'hike' }],
    };
    expect(predicate(artifact)).toEqual([]);
  });

  it('passes when only one mutex token present across artifact', () => {
    const artifact: Artifact = {
      family: 'sequence',
      nodes: [
        { action: 'drop luggage', state: ['luggage_drop'] },
        { action: 'hike' },
      ],
    };
    expect(predicate(artifact)).toEqual([]);
  });

  it('flags when both mutex tokens in the SAME node', () => {
    const artifact: Artifact = {
      family: 'sequence',
      nodes: [
        {
          action: 'confused node',
          state: ['luggage_drop', 'depart_from_hotel'],
        },
      ],
    };
    const violations = predicate(artifact);
    expect(violations).toHaveLength(1);
    expect(violations[0].constraint_id).toBe('state_mutex');
    expect(violations[0].location.node_index).toBe(0);
    expect(violations[0].message).toMatch(/luggage_drop/);
    expect(violations[0].message).toMatch(/depart_from_hotel/);
  });

  it('flags every node that has both mutex tokens', () => {
    const artifact: Artifact = {
      family: 'sequence',
      nodes: [
        { action: 'a', state: ['luggage_drop', 'depart_from_hotel'] },
        { action: 'b' },
        { action: 'c', state: ['luggage_drop', 'depart_from_hotel'] },
      ],
    };
    expect(predicate(artifact)).toHaveLength(2);
  });
});
