import { describe, it, expect } from 'vitest';
import { applyPatches } from '../../src/patch/apply.js';
import type { Artifact } from '../../src/predicates/types.js';
import type { ArtifactPatch } from '../../src/patch/types.js';

describe('applyPatches', () => {
  it('inserts a node at after_index', () => {
    const artifact: Artifact = {
      family: 'sequence',
      nodes: [{ action: 'a', node_type: 'dining' }, { action: 'b', node_type: 'core_experience' }],
    };
    const patches: ArtifactPatch[] = [
      { type: 'insert', after_index: 0, node: { action: 'walk', node_type: 'transit' }, reason: 'fix continuity' },
    ];
    const result = applyPatches(artifact, patches);
    expect(result.nodes).toHaveLength(3);
    expect(result.nodes[1].action).toBe('walk');
    expect(result.nodes[1].node_type).toBe('transit');
  });

  it('replaces a node', () => {
    const artifact: Artifact = {
      family: 'sequence',
      nodes: [{ action: 'old', node_type: 'dining' }],
    };
    const patches: ArtifactPatch[] = [
      { type: 'replace', index: 0, node: { action: 'new', node_type: 'dining' }, reason: 'rewrite' },
    ];
    const result = applyPatches(artifact, patches);
    expect(result.nodes[0].action).toBe('new');
  });

  it('deletes a node', () => {
    const artifact: Artifact = {
      family: 'sequence',
      nodes: [{ action: 'a' }, { action: 'b' }, { action: 'c' }],
    };
    const patches: ArtifactPatch[] = [
      { type: 'delete', index: 1, reason: 'remove' },
    ];
    const result = applyPatches(artifact, patches);
    expect(result.nodes).toHaveLength(2);
    expect(result.nodes.map(n => n.action)).toEqual(['a', 'c']);
  });

  it('updates a field', () => {
    const artifact: Artifact = {
      family: 'sequence',
      nodes: [{ action: 'a', state: ['x'] }],
    };
    const patches: ArtifactPatch[] = [
      { type: 'update_field', index: 0, field: 'state', value: [], reason: 'clear state' },
    ];
    const result = applyPatches(artifact, patches);
    expect(result.nodes[0].state).toEqual([]);
  });

  it('applies multiple patches in order (non-insert first, then insert descending)', () => {
    const artifact: Artifact = {
      family: 'sequence',
      nodes: [{ action: 'a' }, { action: 'b' }],
    };
    const patches: ArtifactPatch[] = [
      { type: 'insert', after_index: 0, node: { action: 'mid' }, reason: 'x' },
      { type: 'update_field', index: 1, field: 'action', value: 'b-renamed', reason: 'y' },
    ];
    const result = applyPatches(artifact, patches);
    // P1: non-insert 先执行(update_field index 1 → b-renamed),
    // 然后 insert 降序插入(insert after 0 → [a, mid, b-renamed])
    expect(result.nodes).toHaveLength(3);
    expect(result.nodes[0].action).toBe('a');
    expect(result.nodes[1].action).toBe('mid');
    expect(result.nodes[2].action).toBe('b-renamed');
  });

  it('returns artifact unchanged for empty patches', () => {
    const artifact: Artifact = { family: 'sequence', nodes: [{ action: 'a' }] };
    expect(applyPatches(artifact, [])).toEqual(artifact);
  });
});
