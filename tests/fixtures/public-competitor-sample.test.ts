import { describe, it, expect } from 'vitest';
import { publicCompetitorSampleSaaS, publicCompetitorSampleOSS } from '../../src/fixtures/public-competitor-sample.js';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadContract } from '../../src/contract/validate.js';
import { compileContract } from '../../src/contract/compiler.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONTRACT = join(__dirname, '..', '..', 'contracts', 'intel-table-v1.yaml');

describe('P4.6 §4 公开竞品快照 fixtures', () => {
  it('publicCompetitorSampleSaaS:3 行,官方定价页来源,无硬违规', () => {
    expect(publicCompetitorSampleSaaS.family).toBe('table');
    expect(publicCompetitorSampleSaaS.nodes.length).toBe(3);
    // 全部 source_trust ≥ 0.85(官方一手源)
    for (const n of publicCompetitorSampleSaaS.nodes) {
      expect(n.source_trust as number).toBeGreaterThanOrEqual(0.85);
      expect(n.source as string).toMatch(/定价页|pricing/);
    }
    // v1.1 契约下无硬违规
    const scorer = compileContract(loadContract(CONTRACT));
    const r = scorer.score(publicCompetitorSampleSaaS);
    expect(r.deterministic.hard_violation_count).toBe(0);
  });

  it('publicCompetitorSampleOSS:2 行,GitHub readme 来源,无硬违规', () => {
    expect(publicCompetitorSampleOSS.family).toBe('table');
    expect(publicCompetitorSampleOSS.nodes.length).toBe(2);
    for (const n of publicCompetitorSampleOSS.nodes) {
      expect(n.source).toContain('github.com');
      expect(n.source_trust as number).toBeGreaterThanOrEqual(0.7);
    }
    const scorer = compileContract(loadContract(CONTRACT));
    const r = scorer.score(publicCompetitorSampleOSS);
    expect(r.deterministic.hard_violation_count).toBe(0);
  });
});
