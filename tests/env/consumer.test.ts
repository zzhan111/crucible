import { describe, it, expect } from 'vitest';
import { consumeEvents } from '../../src/env/consumer.js';
import type { LiveEnvEvent } from '../../src/env/types.js';
import type { Artifact } from '../../src/predicates/types.js';
import type { Contract } from '../../src/contract/schema.js';

const baseArtifact: Artifact = {
  family: 'sequence',
  nodes: [
    { time_block: '09:00', action: 'breakfast', node_type: 'dining', duration_min: 60, elasticity: 'non_compressible', cost: 50, source: 'x', source_trust: 0.5, id: 'node-0', state: ['at_hotel'] },
    { time_block: '10:00', action: 'museum', node_type: 'core_experience', duration_min: 120, elasticity: 'compressible', cost: 80, source: 'y', source_trust: 0.7, id: 'node-1', state: ['hiking'] },
  ],
};

const contract = {
  artifact_family: 'sequence',
  fields: [
    { name: 'cost', type: 'number', required: false },
    { name: 'source', type: 'string', required: false },
    { name: 'source_trust', type: 'number', required: false },
  ],
  hard_constraints: [
    { id: 'time_budget', type: 'declarative' as const, rule: 'sum ≤ 960' },
  ],
  rubric: [],
  calibration: { metric: 'kendall_tau' as const },
} as unknown as Contract;

function mkDisruption(subject: string, severity: 'minor'|'major'|'blocker' = 'minor', invalidates: string[] = []): LiveEnvEvent {
  return { id: '550e8400-e29b-41d4-a716-446655440000', scenario: 's', t_offset_ms: 0, emitted_by: 'replay',
    kind: 'disruption', subject, reason: 'rain', severity, invalidates };
}
function mkInfoDrop(field: string, locator: string, value: unknown, trust = 0.9): LiveEnvEvent {
  return { id: '550e8400-e29b-41d4-a716-446655440001', scenario: 's', t_offset_ms: 0, emitted_by: 'replay',
    kind: 'info_drop', target_field: field, target_locator: locator, new_value: value, evidence: 'url', source_trust: trust };
}
function mkConstraint(cid: string, threshold: unknown): LiveEnvEvent {
  return { id: '550e8400-e29b-41d4-a716-446655440002', scenario: 's', t_offset_ms: 0, emitted_by: 'replay',
    kind: 'constraint_update', constraint_id: cid, new_threshold: threshold, reason: 'r' };
}

describe('consumeEvents', () => {
  it('disruption adds invalidates to per-node state', () => {
    const { artifact, appliedEventIds } = consumeEvents(baseArtifact, [mkDisruption('node-1', 'minor', ['outdoor'])], contract);
    expect(appliedEventIds).toHaveLength(1);
    expect(artifact.nodes[1].state).toContain('outdoor');
  });

  it('disruption blocker forces elasticity to replaceable', () => {
    const { artifact } = consumeEvents(baseArtifact, [mkDisruption('node-1', 'blocker')], contract);
    expect(artifact.nodes[1].elasticity).toBe('replaceable');
  });

  it('disruption minor does not change elasticity', () => {
    const { artifact } = consumeEvents(baseArtifact, [mkDisruption('node-1', 'minor')], contract);
    expect(artifact.nodes[1].elasticity).toBe('compressible');
  });

  it('disruption with unmatched subject is skipped (not applied)', () => {
    const { artifact, appliedEventIds } = consumeEvents(baseArtifact, [mkDisruption('node-99')], contract);
    expect(appliedEventIds).toHaveLength(0);
    expect(artifact.nodes[0].state).toEqual(['at_hotel']);
  });

  it('info_drop updates target_field value + source + source_trust', () => {
    const { artifact, appliedEventIds } = consumeEvents(baseArtifact, [mkInfoDrop('cost', 'node-1', 60, 0.95)], contract);
    expect(appliedEventIds).toHaveLength(1);
    expect(artifact.nodes[1].cost).toBe(60);
    expect(artifact.nodes[1].source).toBe('url');
    expect(artifact.nodes[1].source_trust).toBe(0.95);
  });

  it('info_drop with field not in contract is skipped', () => {
    const { appliedEventIds } = consumeEvents(baseArtifact, [mkInfoDrop('nonexistent', 'node-1', 1)], contract);
    expect(appliedEventIds).toHaveLength(0);
  });

  it('info_drop with unmatched locator is skipped', () => {
    const { appliedEventIds } = consumeEvents(baseArtifact, [mkInfoDrop('cost', 'node-99', 1)], contract);
    expect(appliedEventIds).toHaveLength(0);
  });

  it('constraint_update writes to metadata.runtime_overrides', () => {
    const { artifact, appliedEventIds } = consumeEvents(baseArtifact, [mkConstraint('time_budget', 600)], contract);
    expect(appliedEventIds).toHaveLength(1);
    expect(artifact.metadata?.runtime_overrides?.['time_budget']).toBe(600);
  });

  it('constraint_update with unknown id is skipped', () => {
    const { artifact, appliedEventIds } = consumeEvents(baseArtifact, [mkConstraint('mystery', 1)], contract);
    expect(appliedEventIds).toHaveLength(0);
    expect(artifact.metadata?.runtime_overrides).toBeUndefined();
  });

  it('multiple events apply in order', () => {
    const events = [
      mkDisruption('node-0', 'blocker', ['rain']),
      mkInfoDrop('cost', 'node-1', 100),
      mkConstraint('time_budget', 500),
    ];
    const { artifact, appliedEventIds } = consumeEvents(baseArtifact, events, contract);
    expect(appliedEventIds).toHaveLength(3);
    expect(artifact.nodes[0].elasticity).toBe('replaceable');
    expect(artifact.nodes[0].state).toContain('rain');
    expect(artifact.nodes[1].cost).toBe(100);
    expect(artifact.metadata?.runtime_overrides?.['time_budget']).toBe(500);
  });

  it('does not mutate input artifact', () => {
    const original = JSON.parse(JSON.stringify(baseArtifact));
    consumeEvents(baseArtifact, [mkDisruption('node-0', 'blocker')], contract);
    expect(baseArtifact).toEqual(original);
  });

  it('empty events returns artifact unchanged', () => {
    const { artifact, appliedEventIds } = consumeEvents(baseArtifact, [], contract);
    expect(appliedEventIds).toHaveLength(0);
    expect(artifact.nodes).toEqual(baseArtifact.nodes);
  });
});
