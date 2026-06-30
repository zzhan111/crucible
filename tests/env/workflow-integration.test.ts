import { describe, it, expect, vi, beforeEach } from 'vitest';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { loadContract } from '../../src/contract/validate.js';
import { compileContract } from '../../src/contract/compiler.js';
import { runCrucibleWorkflow } from '../../src/workflow/crucible.js';
import { hk3dayBuggy } from '../../src/fixtures/hk-3day-buggy.js';
import { startLiveEnv } from '../../src/env/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONTRACT_PATH = join(__dirname, '..', '..', 'contracts', 'travel-sequence-v1.yaml');
const TMP = join(tmpdir(), `crucible-wf-env-${Date.now()}`);

beforeEach(() => {
  mkdirSync(TMP, { recursive: true });
  delete process.env.OPENAI_API_KEY;
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

describe('workflow + liveEnv integration', () => {
  it('A: no liveEnv → behavior identical to P3.5 (consumedEventIds empty)', async () => {
    const contract = loadContract(CONTRACT_PATH);
    const baseScorer = compileContract(contract);
    const result = await runCrucibleWorkflow({
      artifact: hk3dayBuggy, contract, baseScorer, artifactId: 'no-env', knownStates: [],
    });
    expect(result.iterations.length).toBeGreaterThan(0);
    for (const it of result.iterations) {
      expect(it.consumedEventIds).toEqual([]);
    }
  });

  it('B: liveEnv with 0 events → equivalent to A', async () => {
    const contract = loadContract(CONTRACT_PATH);
    const baseScorer = compileContract(contract);
    const file = join(TMP, 'empty.jsonl');
    writeFileSync(file, '');
    const handle = await startLiveEnv({ scenario: 'travel-drift', mode: 'replay', fixturePath: file, contract });
    const result = await runCrucibleWorkflow({
      artifact: hk3dayBuggy, contract, baseScorer, artifactId: 'empty-env', knownStates: [], liveEnv: handle,
    });
    for (const it of result.iterations) {
      expect(it.consumedEventIds).toEqual([]);
    }
    await handle.stop();
  });

  it('C: liveEnv with constraint_update event → consumed + applied', async () => {
    const contract = loadContract(CONTRACT_PATH);
    const baseScorer = compileContract(contract);
    // constraint_update 不依赖 artifact node,可在 start 时通过 L2
    const e = { id: '550e8400-e29b-41d4-a716-4466554400c0', scenario: 'travel-drift', t_offset_ms: 0, emitted_by: 'replay',
      kind: 'constraint_update' as const, constraint_id: 'time_budget', new_threshold: 600, reason: 'user tired' };
    const file = join(TMP, 'c.jsonl');
    writeFileSync(file, JSON.stringify(e) + '\n');
    const handle = await startLiveEnv({ scenario: 'travel-drift', mode: 'replay', fixturePath: file, contract });
    await handle.start();
    // 推进让事件进 bus
    await new Promise(r => setTimeout(r, 10));
    const result = await runCrucibleWorkflow({
      artifact: hk3dayBuggy, contract, baseScorer, artifactId: 'with-env', knownStates: [], liveEnv: handle,
    });
    const totalConsumed = result.iterations.reduce((s, it) => s + it.consumedEventIds.length, 0);
    expect(totalConsumed).toBeGreaterThanOrEqual(1);
    await handle.stop();
  });
});
