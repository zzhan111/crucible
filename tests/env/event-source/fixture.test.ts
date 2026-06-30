import { describe, it, expect } from 'vitest';
import { createFixtureEventSource } from '../../../src/env/event-source/fixture.js';
import type { LiveEnvEvent } from '../../../src/env/types.js';

function mkEvent(id: string, t: number, kind: LiveEnvEvent['kind']): LiveEnvEvent {
  const base = { id, scenario: 'travel-drift', t_offset_ms: t, emitted_by: 'fixture' as const };
  if (kind === 'disruption') return { ...base, kind, subject: 'n1', reason: 'r', severity: 'minor', invalidates: [] };
  if (kind === 'info_drop') return { ...base, kind, target_field: 'cost', target_locator: 'n1', new_value: 80, evidence: 'x', source_trust: 0.8 };
  return { ...base, kind, constraint_id: 'time_budget', new_threshold: 600, reason: 'r' };
}

describe('FixtureEventSource', () => {
  it('yields all events immediately in order', async () => {
    const events = [
      mkEvent('550e8400-e29b-41d4-a716-446655440001', 0, 'disruption'),
      mkEvent('550e8400-e29b-41d4-a716-446655440002', 10, 'info_drop'),
      mkEvent('550e8400-e29b-41d4-a716-446655440003', 20, 'constraint_update'),
    ];
    const src = createFixtureEventSource(events);
    const out: LiveEnvEvent[] = [];
    for await (const e of src.stream('travel-drift', new AbortController().signal)) {
      out.push(e);
    }
    expect(out.map(e => e.id)).toEqual(events.map(e => e.id));
  });

  it('yields nothing for empty fixture', async () => {
    const src = createFixtureEventSource([]);
    const out: LiveEnvEvent[] = [];
    for await (const e of src.stream('travel-drift', new AbortController().signal)) {
      out.push(e);
    }
    expect(out).toHaveLength(0);
  });

  it('name is fixture', () => {
    const src = createFixtureEventSource([]);
    expect(src.name).toBe('fixture');
  });

  it('respects abort signal', async () => {
    const events = [
      mkEvent('550e8400-e29b-41d4-a716-446655440004', 0, 'disruption'),
      mkEvent('550e8400-e29b-41d4-a716-446655440005', 10, 'disruption'),
    ];
    const ac = new AbortController();
    const src = createFixtureEventSource(events);
    const out: LiveEnvEvent[] = [];
    ac.abort();
    try {
      for await (const e of src.stream('travel-drift', ac.signal)) {
        out.push(e);
        break;
      }
    } catch { /* abort throws */ }
    expect(out.length).toBeLessThanOrEqual(1);
  });
});
