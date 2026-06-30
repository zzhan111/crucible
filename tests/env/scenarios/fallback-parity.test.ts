import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LiveEnvEvent } from '../../../src/env/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCEN = join(__dirname, '..', '..', '..', 'src', 'env', 'scenarios');

function loadFixture(name: string) {
  return readFileSync(join(SCEN, name), 'utf8').trim().split('\n')
    .filter(l => l).map(l => LiveEnvEvent.parse(JSON.parse(l)));
}

describe('fallback parity (each scenario has all 3 event kinds)', () => {
  for (const sc of ['travel-drift', 'intel-drift']) {
    it(`${sc}.fallback.jsonl has ≥1 of each kind`, () => {
      const events = loadFixture(`${sc}.fallback.jsonl`);
      const kinds = new Set(events.map(e => e.kind));
      expect(kinds.has('disruption')).toBe(true);
      expect(kinds.has('info_drop')).toBe(true);
      expect(kinds.has('constraint_update')).toBe(true);
    });
  }
});
