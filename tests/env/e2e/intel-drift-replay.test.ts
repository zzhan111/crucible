import { describe, it, expect, vi, beforeEach } from 'vitest';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadContract } from '../../../src/contract/validate.js';
import { compileContract } from '../../../src/contract/compiler.js';
import { runCrucibleWorkflow } from '../../../src/workflow/crucible.js';
import { intelTableBuggy } from '../../../src/fixtures/intel-table.js';
import { startLiveEnv } from '../../../src/env/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONTRACT_PATH = join(__dirname, '..', '..', '..', 'contracts', 'intel-table-v1.yaml');
const FIXTURE_PATH = join(__dirname, '..', '..', '..', 'src', 'env', 'scenarios', 'intel-drift.recorded.jsonl');

beforeEach(() => {
  delete process.env.OPENAI_API_KEY;
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

describe('E2E: intel-drift replay', () => {
  it('completes iterations with events consumed', async () => {
    const contract = loadContract(CONTRACT_PATH);
    const baseScorer = compileContract(contract);
    const handle = await startLiveEnv({
      scenario: 'intel-drift', mode: 'replay', fixturePath: FIXTURE_PATH, contract,
    });
    await handle.start();
    await new Promise(r => setTimeout(r, 50));

    const result = await runCrucibleWorkflow({
      artifact: intelTableBuggy, contract, baseScorer, artifactId: 'e2e-intel', knownStates: [], liveEnv: handle,
    });

    expect(result.iterations.length).toBeGreaterThan(0);
    const totalConsumed = result.iterations.reduce((s, it) => s + it.consumedEventIds.length, 0);
    expect(totalConsumed).toBeGreaterThanOrEqual(1);
    await handle.stop();
  }, 15000);
});
