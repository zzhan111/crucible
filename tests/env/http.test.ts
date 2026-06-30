import { describe, it, expect } from 'vitest';
import { formatSseMessage, handleSnapshotRequest, startHttpServer } from '../../src/env/http.js';
import { createEventBus } from '../../src/env/event-bus.js';
import type { LiveEnvEvent } from '../../src/env/types.js';

function mkEvent(id: string): LiveEnvEvent {
  return { id, scenario: 'travel-drift', t_offset_ms: 0, emitted_by: 'replay',
    kind: 'constraint_update', constraint_id: 'time_budget', new_threshold: 500, reason: 'r' };
}

describe('http helpers', () => {
  it('formatSseMessage formats event type + data', () => {
    const msg = formatSseMessage('env-event', { id: 'x' });
    expect(msg).toBe('event: env-event\ndata: {"id":"x"}\n\n');
  });

  it('formatSseMessage handles heartbeat (empty data)', () => {
    const msg = formatSseMessage('heartbeat', '');
    expect(msg).toBe('event: heartbeat\ndata: \n\n');
  });

  it('handleSnapshotRequest returns events + iterations JSON', () => {
    const bus = createEventBus();
    bus.publish(mkEvent('550e8400-e29b-41d4-a716-446655440001'));
    const result = handleSnapshotRequest(bus, []);
    const parsed = JSON.parse(result);
    expect(parsed.events).toHaveLength(1);
    expect(parsed.iterations).toEqual([]);
  });

  it('handleSnapshotRequest includes iterations', () => {
    const bus = createEventBus();
    const result = handleSnapshotRequest(bus, [
      { index: 0, scoreBefore: 0.4, scoreAfter: 0.6, consumedEventIds: ['e1'] },
    ]);
    const parsed = JSON.parse(result);
    expect(parsed.iterations).toHaveLength(1);
    expect(parsed.iterations[0].scoreAfter).toBe(0.6);
  });

  it('startHttpServer serves /env/snapshot and / (HTML)', async () => {
    const bus = createEventBus();
    bus.publish(mkEvent('550e8400-e29b-41d4-a716-446655440002'));
    const server = startHttpServer(bus, [], 0); // port 0 = ephemeral
    await new Promise<void>(resolve => server.once('listening', resolve));
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 5173;
    try {
      const snap = await (await fetch('http://localhost:' + port + '/env/snapshot')).text();
      expect(JSON.parse(snap).events).toHaveLength(1);
      const html = await (await fetch('http://localhost:' + port + '/')).text();
      expect(html).toContain('Crucible Live Env');
      expect(html).toContain('EventSource');  // confirms liveHtmlPage SSE wiring
      const r404 = await fetch('http://localhost:' + port + '/nope');
      expect(r404.status).toBe(404);
    } finally {
      server.close();
    }
  });
});
