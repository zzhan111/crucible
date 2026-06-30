import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createReplayEventSource } from '../../../src/env/event-source/replay.js';
import type { LiveEnvEvent } from '../../../src/env/types.js';

function mkEvent(id: string, t: number): LiveEnvEvent {
  return {
    id, scenario: 'travel-drift', t_offset_ms: t, emitted_by: 'replay',
    kind: 'disruption', subject: 'n1', reason: 'r', severity: 'minor', invalidates: [],
  };
}

const TMP = join(tmpdir(), `crucible-env-test-${Date.now()}`);

beforeEach(() => {
  mkdirSync(TMP, { recursive: true });
  vi.useFakeTimers();
});
afterEach(() => {
  rmSync(TMP, { recursive: true, force: true });
  vi.useRealTimers();
});

function writeJsonl(path: string, events: LiveEnvEvent[]): void {
  writeFileSync(path, events.map(e => JSON.stringify(e)).join('\n') + '\n');
}

describe('ReplayEventSource', () => {
  it('yields events in t_offset_ms order with delays', async () => {
    const file = join(TMP, 'rec.jsonl');
    writeJsonl(file, [
      mkEvent('550e8400-e29b-41d4-a716-446655440001', 0),
      mkEvent('550e8400-e29b-41d4-a716-446655440002', 1000),
      mkEvent('550e8400-e29b-41d4-a716-446655440003', 2500),
    ]);
    const src = createReplayEventSource(file);
    const out: LiveEnvEvent[] = [];
    const iter = src.stream('travel-drift', new AbortController().signal);
    const p = (async () => {
      for await (const e of iter) out.push(e);
    })();
    // t=0 event yields immediately
    await vi.advanceTimersByTimeAsync(0);
    expect(out).toHaveLength(1);
    // advance to t=1000
    await vi.advanceTimersByTimeAsync(1000);
    expect(out).toHaveLength(2);
    // advance to t=2500 (1500 more from 1000)
    await vi.advanceTimersByTimeAsync(1500);
    expect(out).toHaveLength(3);
    await p;
  });

  it('throws when file does not exist', async () => {
    const src = createReplayEventSource(join(TMP, 'missing.jsonl'));
    await expect(async () => {
      for await (const _e of src.stream('travel-drift', new AbortController().signal)) { /* */ }
    }).rejects.toThrow();
  });

  it('throws on malformed JSON line', async () => {
    const file = join(TMP, 'bad.jsonl');
    writeFileSync(file, '{not json}\n');
    const src = createReplayEventSource(file);
    await expect(async () => {
      for await (const _e of src.stream('travel-drift', new AbortController().signal)) { /* */ }
    }).rejects.toThrow();
  });

  it('respects abort signal mid-stream', async () => {
    const file = join(TMP, 'rec2.jsonl');
    writeJsonl(file, [
      mkEvent('550e8400-e29b-41d4-a716-446655440010', 0),
      mkEvent('550e8400-e29b-41d4-a716-446655440011', 5000),
    ]);
    const ac = new AbortController();
    const src = createReplayEventSource(file);
    const out: LiveEnvEvent[] = [];
    const iter = src.stream('travel-drift', ac.signal);
    const p = (async () => {
      for await (const e of iter) out.push(e);
    })();
    await vi.advanceTimersByTimeAsync(0);
    expect(out).toHaveLength(1);
    ac.abort();
    await vi.advanceTimersByTimeAsync(5000);
    await p;
    expect(out).toHaveLength(1); // 第二个未 yield
  });

  it('handles empty file (yields nothing)', async () => {
    const file = join(TMP, 'empty.jsonl');
    writeFileSync(file, '');
    const src = createReplayEventSource(file);
    const out: LiveEnvEvent[] = [];
    for await (const e of src.stream('travel-drift', new AbortController().signal)) {
      out.push(e);
    }
    expect(out).toHaveLength(0);
  });

  it('name is replay', () => {
    const src = createReplayEventSource(join(TMP, 'x.jsonl'));
    expect(src.name).toBe('replay');
  });

  it('filters events by scenario', async () => {
    const file = join(TMP, 'multi.jsonl');
    const e1 = mkEvent('550e8400-e29b-41d4-a716-446655440020', 0);
    const e2 = { ...mkEvent('550e8400-e29b-41d4-a716-446655440021', 1000), scenario: 'intel-drift' };
    writeJsonl(file, [e1, e2]);
    const src = createReplayEventSource(file);
    const out: LiveEnvEvent[] = [];
    const iter = src.stream('travel-drift', new AbortController().signal);
    const p = (async () => {
      for await (const e of iter) out.push(e);
    })();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1000);
    await p;
    expect(out).toHaveLength(1); // 只 travel-drift
    expect(out[0].id).toBe(e1.id);
  });
});
