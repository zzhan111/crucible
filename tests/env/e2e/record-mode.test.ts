import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startLiveEnv } from '../../../src/env/index.js';
import { loadContract } from '../../../src/contract/validate.js';
import { dirname, join as joinPath } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONTRACT_PATH = joinPath(__dirname, '..', '..', '..', 'contracts', 'travel-sequence-v1.yaml');
const TMP = join(tmpdir(), `crucible-e2e-rec-${Date.now()}`);

beforeEach(() => { mkdirSync(TMP, { recursive: true }); vi.spyOn(console, 'warn').mockImplementation(() => {}); });
afterEach(() => { rmSync(TMP, { recursive: true, force: true }); });

describe('E2E: record mode (mock LLM)', () => {
  it('produces JSONL + stats with 0 failures', async () => {
    const contract = loadContract(CONTRACT_PATH);
    let count = 0;
    const jsonlPath = join(TMP, 'rec.jsonl');
    const handle = await startLiveEnv({
      scenario: 'travel-drift', mode: 'record', fixturePath: jsonlPath, contract,
      callFn: async () => {
        count++;
        if (count > 2) return null;
        return { kind: 'constraint_update', constraint_id: 'time_budget', new_threshold: 500 + count, reason: `mock ${count}` };
      },
      maxEvents: 2,
    });
    await handle.start();
    await new Promise(r => setTimeout(r, 100));
    await handle.stop();

    const jsonl = readFileSync(jsonlPath, 'utf8').trim();
    expect(jsonl.length).toBeGreaterThan(0);
    const events = jsonl.split('\n').map(l => JSON.parse(l));
    expect(events).toHaveLength(2);
    expect(events[0].emitted_by).toBe('llm');

    const stats = JSON.parse(readFileSync(join(TMP, 'rec.stats.json'), 'utf8'));
    expect(stats.l1Failures).toBe(0);
    expect(stats.yielded).toBe(2);
  });
});
