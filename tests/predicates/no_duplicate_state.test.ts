import { describe, it, expect } from 'vitest';
import { noDuplicateState } from '../../src/predicates/no_duplicate_state.js';
import type { Artifact } from '../../src/predicates/types.js';

describe('noDuplicateState', () => {
  it('passes when no state tokens', () => {
    expect(noDuplicateState({ family: 'sequence', nodes: [{ action: 'a' }, { action: 'b' }] })).toEqual([]);
  });

  it('passes when state token appears once', () => {
    const artifact: Artifact = {
      family: 'sequence',
      nodes: [{ state: ['hungry'] }, { action: 'no state' }],
    };
    expect(noDuplicateState(artifact)).toEqual([]);
  });

  it('passes when same state in non-consecutive nodes', () => {
    const artifact: Artifact = {
      family: 'sequence',
      nodes: [{ state: ['hungry'] }, { action: 'x' }, { state: ['hungry'] }],
    };
    expect(noDuplicateState(artifact)).toEqual([]);
  });

  it('flags when same state in consecutive nodes without clearing transition', () => {
    const artifact: Artifact = {
      family: 'sequence',
      nodes: [
        { action: 'a', state: ['at_hotel'] },
        { action: 'b', state: ['at_hotel'] },
      ],
    };
    const v = noDuplicateState(artifact);
    expect(v).toHaveLength(1);
    expect(v[0].constraint_id).toBe('no_duplicate_state');
    expect(v[0].location.node_index).toBe(0);
    expect(v[0].location.node_index_end).toBe(1);
    expect(v[0].message).toMatch(/at_hotel/);
  });

  it('does not flag when switch node clears state between them', () => {
    const artifact: Artifact = {
      family: 'sequence',
      nodes: [
        { action: 'a', state: ['at_hotel'] },
        { node_type: 'switch', action: 'leave hotel' },
        { action: 'b', state: ['at_hotel'] },
      ],
    };
    expect(noDuplicateState(artifact)).toEqual([]);
  });

  it('does not flag when buffer node clears state between them', () => {
    const artifact: Artifact = {
      family: 'sequence',
      nodes: [
        { action: 'a', state: ['at_hotel'] },
        { node_type: 'buffer', action: 'wait' },
        { action: 'b', state: ['at_hotel'] },
      ],
    };
    expect(noDuplicateState(artifact)).toEqual([]);
  });

  it('flags multiple duplicate states across the artifact', () => {
    const artifact: Artifact = {
      family: 'sequence',
      nodes: [
        { state: ['x'] }, { state: ['x'] },
        { state: ['y'] }, { state: ['y'] },
      ],
    };
    expect(noDuplicateState(artifact)).toHaveLength(2);
  });
});
