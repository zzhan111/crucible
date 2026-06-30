import { describe, it, expect } from 'vitest';
import { createEventBus } from '../../src/env/event-bus.js';
import type { LiveEnvEvent } from '../../src/env/types.js';

function mkEvent(id: string, t: number): LiveEnvEvent {
  return {
    id, scenario: 'travel-drift', t_offset_ms: t, emitted_by: 'replay',
    kind: 'disruption', subject: 'n1', reason: 'r', severity: 'minor', invalidates: [],
  };
}

describe('EventBus', () => {
  it('publish then snapshot returns the event', () => {
    const bus = createEventBus();
    const e = mkEvent('550e8400-e29b-41d4-a716-446655440000', 0);
    bus.publish(e);
    expect(bus.snapshot()).toHaveLength(1);
    expect(bus.snapshot()[0].id).toBe(e.id);
  });

  it('subscribe receives published events', () => {
    const bus = createEventBus();
    const received: LiveEnvEvent[] = [];
    bus.subscribe(e => received.push(e));
    bus.publish(mkEvent('550e8400-e29b-41d4-a716-446655440001', 10));
    expect(received).toHaveLength(1);
  });

  it('unsubscribe stops receiving', () => {
    const bus = createEventBus();
    const received: LiveEnvEvent[] = [];
    const unsub = bus.subscribe(e => received.push(e));
    bus.publish(mkEvent('550e8400-e29b-41d4-a716-446655440002', 0));
    unsub();
    bus.publish(mkEvent('550e8400-e29b-41d4-a716-446655440003', 10));
    expect(received).toHaveLength(1);
  });

  it('drain returns accumulated events and clears pointer', () => {
    const bus = createEventBus();
    bus.publish(mkEvent('550e8400-e29b-41d4-a716-446655440004', 0));
    bus.publish(mkEvent('550e8400-e29b-41d4-a716-446655440005', 10));
    const drained = bus.drain();
    expect(drained).toHaveLength(2);
    expect(bus.drain()).toHaveLength(0);
  });

  it('drain and subscribe are independent — snapshot retains all', () => {
    const bus = createEventBus();
    bus.publish(mkEvent('550e8400-e29b-41d4-a716-446655440006', 0));
    bus.drain();
    expect(bus.snapshot()).toHaveLength(1);
  });

  it('multiple subscribers all receive', () => {
    const bus = createEventBus();
    let count = 0;
    bus.subscribe(() => count++);
    bus.subscribe(() => count++);
    bus.publish(mkEvent('550e8400-e29b-41d4-a716-446655440007', 0));
    expect(count).toBe(2);
  });

  it('snapshot is read-only (does not affect drain)', () => {
    const bus = createEventBus();
    bus.publish(mkEvent('550e8400-e29b-41d4-a716-446655440008', 0));
    const snap = bus.snapshot();
    expect(snap.length).toBe(1);
    expect(bus.drain()).toHaveLength(1);
  });

  it('preserves publication order in snapshot', () => {
    const bus = createEventBus();
    bus.publish(mkEvent('550e8400-e29b-41d4-a716-446655440009', 30));
    bus.publish(mkEvent('550e8400-e29b-41d4-a716-446655440010', 10));
    const snap = bus.snapshot();
    expect(snap[0].t_offset_ms).toBe(30);
    expect(snap[1].t_offset_ms).toBe(10);
  });

  it('drain preserves publication order', () => {
    const bus = createEventBus();
    bus.publish(mkEvent('550e8400-e29b-41d4-a716-446655440011', 30));
    bus.publish(mkEvent('550e8400-e29b-41d4-a716-446655440012', 10));
    const drained = bus.drain();
    expect(drained[0].t_offset_ms).toBe(30);
    expect(drained[1].t_offset_ms).toBe(10);
  });

  it('subscribe handler throwing does not break other subscribers', () => {
    const bus = createEventBus();
    bus.subscribe(() => { throw new Error('boom'); });
    let received = false;
    bus.subscribe(() => { received = true; });
    bus.publish(mkEvent('550e8400-e29b-41d4-a716-446655440013', 0));
    expect(received).toBe(true);
  });
});
