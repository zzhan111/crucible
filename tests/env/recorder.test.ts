import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { recordScenario } from '../../src/env/recorder.js';

const TMP = join(tmpdir(), `crucible-rec-${Date.now()}`);
beforeEach(() => mkdirSync(TMP, { recursive: true }));
afterEach(() => rmSync(TMP, { recursive: true, force: true }));

describe('recorder', () => {
  it('writes JSONL + stats files', async () => {
    const jsonlPath = join(TMP, 'out.jsonl');
    const statsPath = join(TMP, 'out.stats.json');
    const stats = await recordScenario({
      scenario: 'travel-drift',
      contract: { artifact_family: 'sequence', fields: [], hard_constraints: [{ id: 'time_budget', type: 'declarative' }], rubric: [], calibration: { metric: 'kendall_tau' } } as any,
      callFn: async () => ({ kind: 'constraint_update', constraint_id: 'time_budget', new_threshold: 500, reason: 'r' }),
      jsonlPath,
      statsPath,
      maxEvents: 2,
    });
    const jsonl = readFileSync(jsonlPath, 'utf8').trim().split('\n');
    expect(jsonl).toHaveLength(2);
    JSON.parse(jsonl[0]); // 不抛
    const statsFile = JSON.parse(readFileSync(statsPath, 'utf8'));
    expect(statsFile.totalCalls).toBe(2);
    expect(statsFile.l1Failures).toBe(0);
    expect(statsFile.l2Failures).toBe(0);
    expect(stats.yielded).toBe(2);
  });

  it('stats records L1 failures', async () => {
    const stats = await recordScenario({
      scenario: 'travel-drift',
      contract: { artifact_family: 'sequence', fields: [], hard_constraints: [{ id: 'time_budget', type: 'declarative' }], rubric: [], calibration: { metric: 'kendall_tau' } } as any,
      callFn: async () => ({ kind: 'bad' }), // L1 fail
      jsonlPath: join(TMP, 'bad.jsonl'),
      statsPath: join(TMP, 'bad.stats.json'),
      maxEvents: 5,
    });
    expect(stats.l1Failures).toBeGreaterThan(0);
    expect(stats.yielded).toBe(0);
  });

  it('empty output when callFn always returns null', async () => {
    const jsonlPath = join(TMP, 'empty.jsonl');
    await recordScenario({
      scenario: 'travel-drift',
      contract: { artifact_family: 'sequence', fields: [], hard_constraints: [{ id: 'time_budget', type: 'declarative' }], rubric: [], calibration: { metric: 'kendall_tau' } } as any,
      callFn: async () => null,
      jsonlPath,
      statsPath: join(TMP, 'empty.stats.json'),
    });
    const content = readFileSync(jsonlPath, 'utf8');
    expect(content.trim()).toBe('');
  });
});
