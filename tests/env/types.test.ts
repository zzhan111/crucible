import { describe, it, expect } from 'vitest';
import { LiveEnvEvent } from '../../src/env/types.js';

describe('LiveEnvEvent zod schema', () => {
  const validEnvelope = {
    id: '550e8400-e29b-41d4-a716-446655440000',
    scenario: 'travel-drift',
    t_offset_ms: 12000,
    emitted_by: 'replay',
  };

  it('accepts a valid disruption event', () => {
    const e = { ...validEnvelope, kind: 'disruption', subject: 'node-2', reason: 'rain', severity: 'minor', invalidates: ['outdoor'] };
    expect(LiveEnvEvent.safeParse(e).success).toBe(true);
  });

  it('accepts disruption with default empty invalidates', () => {
    const e = { ...validEnvelope, kind: 'disruption', subject: 'node-2', reason: 'rain', severity: 'blocker' };
    const parsed = LiveEnvEvent.safeParse(e);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.invalidates).toEqual([]);
  });

  it('accepts a valid info_drop event', () => {
    const e = { ...validEnvelope, kind: 'info_drop', target_field: 'cost', target_locator: 'node-2', new_value: 80, evidence: 'https://example.com', source_trust: 0.8 };
    expect(LiveEnvEvent.safeParse(e).success).toBe(true);
  });

  it('accepts a valid constraint_update event', () => {
    const e = { ...validEnvelope, kind: 'constraint_update', constraint_id: 'time_budget', new_threshold: 600, reason: 'user tired' };
    expect(LiveEnvEvent.safeParse(e).success).toBe(true);
  });

  it('rejects missing id', () => {
    const e = { scenario: 'travel-drift', t_offset_ms: 0, emitted_by: 'replay', kind: 'disruption', subject: 'n', reason: 'r', severity: 'minor' };
    expect(LiveEnvEvent.safeParse(e).success).toBe(false);
  });

  it('rejects non-uuid id', () => {
    const e = { ...validEnvelope, id: 'not-a-uuid', kind: 'disruption', subject: 'n', reason: 'r', severity: 'minor' };
    expect(LiveEnvEvent.safeParse(e).success).toBe(false);
  });

  it('rejects invalid emitted_by', () => {
    const e = { ...validEnvelope, emitted_by: 'human', kind: 'disruption', subject: 'n', reason: 'r', severity: 'minor' };
    expect(LiveEnvEvent.safeParse(e).success).toBe(false);
  });

  it('rejects invalid severity', () => {
    const e = { ...validEnvelope, kind: 'disruption', subject: 'n', reason: 'r', severity: 'catastrophic' };
    expect(LiveEnvEvent.safeParse(e).success).toBe(false);
  });

  it('rejects info_drop with source_trust out of range', () => {
    const e = { ...validEnvelope, kind: 'info_drop', target_field: 'cost', target_locator: 'n', new_value: 1, evidence: 'x', source_trust: 1.5 };
    expect(LiveEnvEvent.safeParse(e).success).toBe(false);
  });

  it('rejects negative t_offset_ms', () => {
    const e = { ...validEnvelope, t_offset_ms: -1, kind: 'disruption', subject: 'n', reason: 'r', severity: 'minor' };
    expect(LiveEnvEvent.safeParse(e).success).toBe(false);
  });

  it('rejects unknown kind', () => {
    const e = { ...validEnvelope, kind: 'mystery', subject: 'n' };
    expect(LiveEnvEvent.safeParse(e).success).toBe(false);
  });

  it('rejects disruption missing subject', () => {
    const e = { ...validEnvelope, kind: 'disruption', reason: 'r', severity: 'minor' };
    expect(LiveEnvEvent.safeParse(e).success).toBe(false);
  });
});
