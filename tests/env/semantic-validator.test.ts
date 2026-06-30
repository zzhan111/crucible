import { describe, it, expect } from 'vitest';
import { validateSemantics } from '../../src/env/semantic-validator.js';
import type { LiveEnvEvent } from '../../src/env/types.js';
import type { Artifact } from '../../src/predicates/types.js';
import type { Contract } from '../../src/contract/schema.js';

const artifact: Artifact = {
  family: 'sequence',
  nodes: [
    { time_block: '09:00', action: 'breakfast', node_type: 'dining', duration_min: 60, elasticity: 'non_compressible', id: 'node-0' },
    { time_block: '10:00', action: 'museum', node_type: 'core_experience', duration_min: 120, elasticity: 'compressible', id: 'node-1' },
  ],
};

const contract = {
  artifact_family: 'sequence',
  fields: [
    { name: 'time_block', type: 'string', required: true },
    { name: 'action', type: 'string', required: true },
    { name: 'cost', type: 'number', required: false },
  ],
  hard_constraints: [
    { id: 'continuity', type: 'declarative' as const, rule: 'adjacent transit' },
    { id: 'time_budget', type: 'declarative' as const, rule: 'sum ≤ 960' },
  ],
  rubric: [],
  calibration: { metric: 'kendall_tau' as const },
} as unknown as Contract;

const ctx = { artifact, contract };

function mkDisruption(subject: string): LiveEnvEvent {
  return { id: '550e8400-e29b-41d4-a716-446655440000', scenario: 's', t_offset_ms: 0, emitted_by: 'replay',
    kind: 'disruption', subject, reason: 'r', severity: 'minor', invalidates: [] };
}
function mkInfoDrop(field: string, locator: string): LiveEnvEvent {
  return { id: '550e8400-e29b-41d4-a716-446655440001', scenario: 's', t_offset_ms: 0, emitted_by: 'replay',
    kind: 'info_drop', target_field: field, target_locator: locator, new_value: 1, evidence: 'x', source_trust: 0.5 };
}
function mkConstraint(cid: string): LiveEnvEvent {
  return { id: '550e8400-e29b-41d4-a716-446655440002', scenario: 's', t_offset_ms: 0, emitted_by: 'replay',
    kind: 'constraint_update', constraint_id: cid, new_threshold: 100, reason: 'r' };
}

describe('validateSemantics (L2)', () => {
  it('disruption: ok when subject exists', () => {
    expect(validateSemantics(mkDisruption('node-1'), ctx).ok).toBe(true);
  });
  it('disruption: rejects when subject not found', () => {
    expect(validateSemantics(mkDisruption('node-99'), ctx).ok).toBe(false);
  });
  it('info_drop: ok when field + locator exist', () => {
    expect(validateSemantics(mkInfoDrop('cost', 'node-1'), ctx).ok).toBe(true);
  });
  it('info_drop: rejects when target_field not in contract', () => {
    expect(validateSemantics(mkInfoDrop('nonexistent', 'node-1'), ctx).ok).toBe(false);
  });
  it('info_drop: rejects when locator not found', () => {
    expect(validateSemantics(mkInfoDrop('cost', 'node-99'), ctx).ok).toBe(false);
  });
  it('constraint_update: ok when constraint_id exists', () => {
    expect(validateSemantics(mkConstraint('time_budget'), ctx).ok).toBe(true);
  });
  it('constraint_update: rejects when constraint_id not in contract', () => {
    expect(validateSemantics(mkConstraint('mystery'), ctx).ok).toBe(false);
  });
});
