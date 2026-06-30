import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startLiveEnv } from '../../src/env/index.js';
import type { Artifact } from '../../src/predicates/types.js';

const TMP = join(tmpdir(), `crucible-env-idx-${Date.now()}`);
beforeEach(() => { mkdirSync(TMP, { recursive: true }); vi.useFakeTimers(); });
afterEach(() => { rmSync(TMP, { recursive: true, force: true }); vi.useRealTimers(); });

const artifact: Artifact = {
  family: 'sequence',
  nodes: [{ time_block: '09:00', action: 'x', node_type: 'dining', duration_min: 60, elasticity: 'non_compressible', id: 'node-0' }],
};

const contract = {
  artifact_family: 'sequence', fields: [{ name: 'cost', type: 'number', required: false }],
  hard_constraints: [{ id: 'time_budget', type: 'declarative' as const, rule: 'x' }],
  rubric: [], calibration: { metric: 'kendall_tau' as const },
} as any;

describe('startLiveEnv / EnvHandle', () => {
  it('creates handle with replay source', async () => {
    const file = join(TMP, 'rec.jsonl');
    const e = { id: '550e8400-e29b-41d4-a716-446655440000', scenario: 'travel-drift', t_offset_ms: 0, emitted_by: 'replay',
      kind: 'constraint_update' as const, constraint_id: 'time_budget', new_threshold: 500, reason: 'r' };
    writeFileSync(file, JSON.stringify(e) + '\n');
    const handle = await startLiveEnv({ scenario: 'travel-drift', mode: 'replay', fixturePath: file, contract });
    expect(handle.scenario).toBe('travel-drift');
    expect(handle.runId).toBeTruthy();
    expect(typeof handle.consume).toBe('function');
    await handle.stop();
  });

  it('consume with no events returns artifact unchanged', async () => {
    const file = join(TMP, 'empty.jsonl');
    writeFileSync(file, '');
    const handle = await startLiveEnv({ scenario: 'travel-drift', mode: 'replay', fixturePath: file, contract });
    const { artifact: out, appliedEventIds } = handle.consume(artifact);
    expect(appliedEventIds).toHaveLength(0);
    expect(out.nodes).toEqual(artifact.nodes);
    await handle.stop();
  });

  it('start pumps events into bus, consume drains them', async () => {
    const file = join(TMP, 'rec2.jsonl');
    const e = { id: '550e8400-e29b-41d4-a716-446655440001', scenario: 'travel-drift', t_offset_ms: 0, emitted_by: 'replay',
      kind: 'constraint_update' as const, constraint_id: 'time_budget', new_threshold: 500, reason: 'r' };
    writeFileSync(file, JSON.stringify(e) + '\n');
    const handle = await startLiveEnv({ scenario: 'travel-drift', mode: 'replay', fixturePath: file, contract });
    await handle.start();
    // 让 replay source 把事件 yield 进 bus(fake timer 推进)
    await vi.advanceTimersByTimeAsync(0);
    const { appliedEventIds } = handle.consume(artifact);
    expect(appliedEventIds).toContain(e.id);
    await handle.stop();
  });

  it('snapshot returns events seen so far', async () => {
    const file = join(TMP, 'rec3.jsonl');
    const e = { id: '550e8400-e29b-41d4-a716-446655440002', scenario: 'travel-drift', t_offset_ms: 0, emitted_by: 'replay',
      kind: 'constraint_update' as const, constraint_id: 'time_budget', new_threshold: 500, reason: 'r' };
    writeFileSync(file, JSON.stringify(e) + '\n');
    const handle = await startLiveEnv({ scenario: 'travel-drift', mode: 'replay', fixturePath: file, contract });
    await handle.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(handle.bus.snapshot()).toHaveLength(1);
    await handle.stop();
  });
});
