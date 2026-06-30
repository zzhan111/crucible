import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCEN = join(__dirname, '..', '..', '..', 'src', 'env', 'scenarios');

describe('recorded quality CI gate', () => {
  for (const sc of ['travel-drift', 'intel-drift']) {
    it(`${sc}.record-stats.json has 0 L1/L2 failures`, () => {
      const stats = JSON.parse(readFileSync(join(SCEN, `${sc}.record-stats.json`), 'utf8'));
      expect(stats.l1Failures).toBe(0);
      expect(stats.l2Failures).toBe(0);
    });
  }
});
