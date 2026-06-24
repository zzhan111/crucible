import { describe, it, expect, vi, beforeEach } from 'vitest';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadContract } from '../../src/contract/validate.js';
import { fanoutJudges } from '../../src/rubric/fanout.js';
import type { Artifact } from '../../src/predicates/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONTRACT_PATH = join(__dirname, '..', '..', 'contracts', 'travel-sequence-v1.yaml');

describe('fanoutJudges (eng-review T3 直接覆盖)', () => {
  beforeEach(() => {
    delete process.env.OPENROUTER_API_KEY;
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('returns exactly 3 RubricScores for travel-sequence-v1 contract', async () => {
    const contract = loadContract(CONTRACT_PATH);
    const artifact: Artifact = {
      family: 'sequence',
      nodes: [
        { node_type: 'dining', action: 'breakfast' },
        { node_type: 'transit', action: 'walk' },
        { node_type: 'core_experience', action: 'hike' },
      ],
    };
    const results = await fanoutJudges(artifact, contract);
    expect(results).toHaveLength(3);
  });

  it('covers all 3 judge dims: routing, memorability, dining_fit', async () => {
    const contract = loadContract(CONTRACT_PATH);
    const artifact: Artifact = {
      family: 'sequence',
      nodes: [{ node_type: 'dining', action: 'breakfast' }],
    };
    const results = await fanoutJudges(artifact, contract);
    const dims = results.map(r => r.dim).sort();
    expect(dims).toEqual(['dining_fit', 'memorability', 'routing']);
  });

  it('returns neutral 0.5 scores when no API key (degraded mode)', async () => {
    const contract = loadContract(CONTRACT_PATH);
    const artifact: Artifact = {
      family: 'sequence',
      nodes: [{ node_type: 'dining', action: 'breakfast' }],
    };
    const results = await fanoutJudges(artifact, contract);
    for (const r of results) {
      expect(r.score).toBe(0.5); // neutral fallback
    }
  });

  it('routing score carries proxy_value (proxy+judge mode)', async () => {
    const contract = loadContract(CONTRACT_PATH);
    const artifact: Artifact = {
      family: 'sequence',
      nodes: [
        { node_type: 'dining' },
        { node_type: 'transit' },
        { node_type: 'core_experience' },
      ],
    };
    const results = await fanoutJudges(artifact, contract);
    const routing = results.find(r => r.dim === 'routing');
    expect(routing).toBeDefined();
    expect(routing!.mode).toBe('proxy+judge');
    expect(routing!.proxy_value).toBe(1.0); // fully bridged
  });

  it('handles empty artifact nodes', async () => {
    const contract = loadContract(CONTRACT_PATH);
    const artifact: Artifact = { family: 'sequence', nodes: [] };
    const results = await fanoutJudges(artifact, contract);
    expect(results).toHaveLength(3); // still 3 judge dims, just scored on empty artifact
  });
});
