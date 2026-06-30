import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startLiveEnv } from '../../src/env/index.js';

const TMP = join(tmpdir(), `crucible-idx-rec-${Date.now()}`);
beforeEach(() => mkdirSync(TMP, { recursive: true }));
afterEach(() => rmSync(TMP, { recursive: true, force: true }));

const contract = {
  artifact_family: 'sequence', fields: [],
  hard_constraints: [{ id: 'time_budget', type: 'declarative' as const }],
  rubric: [], calibration: { metric: 'kendall_tau' as const },
} as any;

describe('startLiveEnv record mode', () => {
  it('does not throw "not implemented"', async () => {
    const handle = await startLiveEnv({
      scenario: 'travel-drift', mode: 'record',
      fixturePath: join(TMP, 'out.jsonl'), contract,
      callFn: async () => ({ kind: 'constraint_update', constraint_id: 'time_budget', new_threshold: 500, reason: 'r' }),
      maxEvents: 1,
    });
    expect(handle.scenario).toBe('travel-drift');
    await handle.start();
    await new Promise(r => setTimeout(r, 50));
    await handle.stop();
    const content = readFileSync(join(TMP, 'out.jsonl'), 'utf8');
    expect(content.trim().length).toBeGreaterThan(0);
  });
});
