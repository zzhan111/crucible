import { describe, it, expect, vi, beforeEach } from 'vitest';
import { detectNovelty } from '../../src/agents/curator.js';
import type { Artifact } from '../../src/predicates/types.js';
import { hk3dayGolden } from '../../src/fixtures/hk-3day-golden.js';

describe('Curator detectNovelty', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('returns empty proposals for golden artifact (no novelty)', async () => {
    const proposals = await detectNovelty(hk3dayGolden, ['at_hotel', 'hiking', 'luggage_drop', 'depart_from_hotel']);
    expect(proposals).toEqual([]);
  });

  it('returns proposal when artifact has unseen state token', async () => {
    const artifact: Artifact = {
      family: 'sequence',
      nodes: [{ action: 'x', node_type: 'dining', state: ['new_unseen_state'] }],
    };
    const proposals = await detectNovelty(artifact, ['at_hotel', 'hiking']);
    expect(proposals.length).toBeGreaterThanOrEqual(1);
    expect(proposals[0].dim).toBe('state');
    expect(proposals[0].tokens).toContain('new_unseen_state');
  });

  it('returns proposal when artifact has unseen node_type', async () => {
    const artifact: Artifact = {
      family: 'sequence',
      nodes: [{ action: 'x', node_type: 'shopping' }],
    };
    const proposals = await detectNovelty(artifact, [], ['dining', 'transit', 'core_experience']);
    expect(proposals.length).toBeGreaterThanOrEqual(1);
    expect(proposals[0].dim).toBe('node_type');
    expect(proposals[0].tokens).toContain('shopping');
  });

  it('proposal has rationale', async () => {
    const artifact: Artifact = {
      family: 'sequence',
      nodes: [{ action: 'x', state: ['novel'] }],
    };
    const proposals = await detectNovelty(artifact, []);
    expect(proposals[0].rationale.length).toBeGreaterThan(5);
  });
});
