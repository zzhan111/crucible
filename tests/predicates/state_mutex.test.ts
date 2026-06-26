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

  // P1 新增:相邻节点互斥
  it('flags when adjacent nodes hold mutex tokens (node 0 has a, node 1 has b)', () => {
    const artifact: Artifact = {
      family: 'sequence',
      nodes: [
        { action: 'drop luggage', state: ['luggage_drop'] },
        { action: 'depart from hotel', state: ['depart_from_hotel'] },
      ],
    };
    const violations = predicate(artifact);
    expect(violations).toHaveLength(1);
    expect(violations[0].constraint_id).toBe('state_mutex');
    expect(violations[0].message).toMatch(/adjacent/);
    expect(violations[0].location.node_index).toBe(0);
    expect(violations[0].location.node_index_end).toBe(1);
  });

  it('does not flag adjacent mutex when switch node clears between them', () => {
    const artifact: Artifact = {
      family: 'sequence',
      nodes: [
        { action: 'drop luggage', state: ['luggage_drop'] },
        { node_type: 'switch', action: 'leave hotel' },
        { action: 'depart from hotel', state: ['depart_from_hotel'] },
      ],
    };
    expect(predicate(artifact)).toEqual([]);
  });

  it('does not flag adjacent mutex when buffer node clears between them', () => {
    const artifact: Artifact = {
      family: 'sequence',
      nodes: [
        { action: 'drop luggage', state: ['luggage_drop'] },
        { node_type: 'buffer', action: 'wait' },
        { action: 'depart from hotel', state: ['depart_from_hotel'] },
      ],
    };
    expect(predicate(artifact)).toEqual([]);
  });

  it('flags both same-node and adjacent-node mutex if both present', () => {
    const artifact: Artifact = {
      family: 'sequence',
      nodes: [
        { action: 'confused', state: ['luggage_drop', 'depart_from_hotel'] },
        { action: 'also confused', state: ['luggage_drop'] },
      ],
    };
    // 节点 0: 同节点互斥 (luggage_drop + depart_from_hotel)
    // 节点 0→1: 节点0有 luggage_drop+depart_from_hotel, 节点1有 luggage_drop
    //   相邻互斥检查: 节点0有a且节点1有b? 节点0有depart_from_hotel(b), 节点1有luggage_drop(a) → 是!
    // 所以: 1 同节点 + 1 相邻 = 2 violations
    const violations = predicate(artifact);
    expect(violations).toHaveLength(2);
    expect(violations[0].message).toMatch(/both mutex states/);
    expect(violations[1].message).toMatch(/adjacent/);
  });
});
