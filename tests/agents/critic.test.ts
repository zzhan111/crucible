import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generatePatches } from '../../src/agents/critic.js';
import type { Artifact, Violation } from '../../src/predicates/types.js';
import type { ScoreReport } from '../../src/rubric/types.js';
import { hk3dayBuggy } from '../../src/fixtures/hk-3day-buggy.js';

function makeReport(violations: Violation[]): ScoreReport {
  return {
    deterministic: {
      violations,
      rubric_scores: [],
      hard_violation_count: violations.length,
      deterministic_score: 1 - violations.length * 0.15,
    },
    judge: { rubric_scores: [], overall_score: 0.5 },
    final_score: 0.5,
  };
}

describe('Critic generatePatches', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('generates insert patch for continuity violation', async () => {
    const violations: Violation[] = [{
      constraint_id: 'continuity',
      severity: 'hard',
      message: 'adjacent nodes at index 0 and 1 have no transit/switch bridge',
      location: { node_index: 0, node_index_end: 1 },
      fix_hint: 'insert a transit or switch node between these two nodes',
    }];
    const report = makeReport(violations);
    const patches = await generatePatches(report, hk3dayBuggy);
    const insertPatches = patches.filter(p => p.type === 'insert');
    expect(insertPatches.length).toBeGreaterThanOrEqual(1);
    expect(insertPatches[0].type === 'insert' && insertPatches[0].after_index).toBe(0);
  });

  it('generates update_field patch for state_mutex violation (clear one token)', async () => {
    const violations: Violation[] = [{
      constraint_id: 'state_mutex',
      severity: 'hard',
      message: 'node 0 holds both mutex states: luggage_drop and depart_from_hotel',
      location: { node_index: 0, field: 'state' },
      fix_hint: 'remove one of luggage_drop/depart_from_hotel from this node',
    }];
    const report = makeReport(violations);
    const patches = await generatePatches(report, hk3dayBuggy);
    const updatePatches = patches.filter(p => p.type === 'update_field' && p.field === 'state');
    expect(updatePatches.length).toBeGreaterThanOrEqual(1);
  });

  it('generates update_field patch for no_duplicate_state violation', async () => {
    const violations: Violation[] = [{
      constraint_id: 'no_duplicate_state',
      severity: 'hard',
      message: 'state "at_hotel" persists across consecutive nodes 0 and 1 without a clearing transition',
      location: { node_index: 0, node_index_end: 1, field: 'state' },
      fix_hint: 'insert a switch or buffer node between them, or remove the duplicate state',
    }];
    const report = makeReport(violations);
    const patches = await generatePatches(report, hk3dayBuggy);
    expect(patches.length).toBeGreaterThanOrEqual(1);
  });

  it('returns empty patches for zero violations', async () => {
    const report = makeReport([]);
    const patches = await generatePatches(report, hk3dayBuggy);
    expect(patches).toEqual([]);
  });

  it('every patch has a reason', async () => {
    const violations: Violation[] = [
      { constraint_id: 'continuity', severity: 'hard', message: 'gap 0-1', location: { node_index: 0, node_index_end: 1 }, fix_hint: 'insert transit' },
    ];
    const report = makeReport(violations);
    const patches = await generatePatches(report, hk3dayBuggy);
    for (const p of patches) {
      expect(p.reason.length).toBeGreaterThan(5);
    }
  });
});
