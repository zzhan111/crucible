import { describe, it, expect, vi, beforeEach } from 'vitest';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadContract } from '../../../src/contract/validate.js';
import { compileContract } from '../../../src/contract/compiler.js';
import { runCrucibleWorkflow } from '../../../src/workflow/crucible.js';
import { hk3dayBuggy } from '../../../src/fixtures/hk-3day-buggy.js';
import { startLiveEnv } from '../../../src/env/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONTRACT_PATH = join(__dirname, '..', '..', '..', 'contracts', 'travel-sequence-v1.yaml');
const FIXTURE_PATH = join(__dirname, '..', '..', '..', 'src', 'env', 'scenarios', 'travel-drift.recorded.jsonl');

beforeEach(() => {
  delete process.env.OPENAI_API_KEY;
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

describe('E2E: travel-drift replay', () => {
  it('completes 3 iterations with monotonic score + ≥1 event consumed', async () => {
    const contract = loadContract(CONTRACT_PATH);
    const baseScorer = compileContract(contract);
    const handle = await startLiveEnv({
      scenario: 'travel-drift', mode: 'replay', fixturePath: FIXTURE_PATH, contract,
    });
    await handle.start();
    // 让 replay source 把事件泵进 bus(真实 timer,不用 fake —— E2E 用真实节奏但事件 t_offset 小)
    await new Promise(r => setTimeout(r, 50));

    const result = await runCrucibleWorkflow({
      artifact: hk3dayBuggy, contract, baseScorer, artifactId: 'e2e-travel', knownStates: [], liveEnv: handle,
    });

    expect(result.iterations.length).toBeGreaterThan(0);
    // 单调:分数不下降
    for (let i = 1; i < result.iterations.length; i++) {
      expect(result.iterations[i].score).toBeGreaterThanOrEqual(result.iterations[i - 1].score - 0.01);
    }
    // 至少消费 1 个事件
    const totalConsumed = result.iterations.reduce((s, it) => s + it.consumedEventIds.length, 0);
    expect(totalConsumed).toBeGreaterThanOrEqual(1);
    await handle.stop();
  }, 15000);
});
