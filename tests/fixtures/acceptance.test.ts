import { describe, it, expect } from 'vitest';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadContract } from '../../src/contract/validate.js';
import { compileContract } from '../../src/contract/compiler.js';
import { hk3dayBuggy } from '../../src/fixtures/hk-3day-buggy.js';
import { hk3dayGolden } from '../../src/fixtures/hk-3day-golden.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONTRACT_PATH = join(__dirname, '..', '..', 'contracts', 'travel-sequence-v1.yaml');

describe('P0 acceptance 4.1 — 3 bugs must be caught by deterministic scorer', () => {
  const contract = loadContract(CONTRACT_PATH);
  const scorer = compileContract(contract);

  it('golden artifact has zero hard violations', () => {
    const report = scorer.score(hk3dayGolden);
    expect(report.deterministic.hard_violation_count).toBe(0);
    expect(report.deterministic.violations).toEqual([]);
  });

  it('buggy artifact catches continuity violation (Bug 1)', () => {
    const report = scorer.score(hk3dayBuggy);
    const continuityV = report.deterministic.violations.filter(
      v => v.constraint_id === 'continuity'
    );
    expect(continuityV).toHaveLength(1); // dining(0) → core_experience(1)
    expect(continuityV[0].location.node_index).toBe(0);
    expect(continuityV[0].location.node_index_end).toBe(1);
  });

  it('buggy artifact catches state_mutex violation (Bug 2)', () => {
    const report = scorer.score(hk3dayBuggy);
    const mutexV = report.deterministic.violations.filter(
      v => v.constraint_id === 'state_mutex'
    );
    expect(mutexV).toHaveLength(1);
    expect(mutexV[0].message).toMatch(/luggage_drop/);
    expect(mutexV[0].message).toMatch(/depart_from_hotel/);
  });

  it('buggy artifact catches no_duplicate_state violation (Bug 3)', () => {
    const report = scorer.score(hk3dayBuggy);
    const dupV = report.deterministic.violations.filter(
      v => v.constraint_id === 'no_duplicate_state'
    );
    expect(dupV).toHaveLength(1);
    expect(dupV[0].message).toMatch(/at_hotel/);
  });

  it('buggy artifact has exactly 3 hard violations total (1 continuity + 1 mutex + 1 duplicate)', () => {
    const report = scorer.score(hk3dayBuggy);
    expect(report.deterministic.hard_violation_count).toBe(3);
  });

  it('buggy artifact scores lower than golden', () => {
    const goldenReport = scorer.score(hk3dayGolden);
    const buggyReport = scorer.score(hk3dayBuggy);
    expect(buggyReport.final_score).toBeLessThan(goldenReport.final_score);
  });

  // fix_hint + location 契约(eng-review T2):为 Part 2 Critic Agent 预留可读契约
  it('every violation has non-empty fix_hint and correct location', () => {
    const report = scorer.score(hk3dayBuggy);
    for (const v of report.deterministic.violations) {
      expect(v.fix_hint, `violation ${v.constraint_id} missing fix_hint`).toBeTruthy();
      expect(v.fix_hint!.length, `violation ${v.constraint_id} fix_hint too short`).toBeGreaterThan(10);
      expect(v.location, `violation ${v.constraint_id} missing location`).toBeDefined();
    }
  });

  it('continuity violation points to node 0→1 (dining→core_experience gap)', () => {
    const report = scorer.score(hk3dayBuggy);
    const v = report.deterministic.violations.find(v => v.constraint_id === 'continuity');
    expect(v).toBeDefined();
    expect(v!.location.node_index).toBe(0);
    expect(v!.location.node_index_end).toBe(1);
    expect(v!.fix_hint).toMatch(/transit|switch/i);
  });

  it('state_mutex violation points to node 0 (holds both mutex tokens)', () => {
    const report = scorer.score(hk3dayBuggy);
    const v = report.deterministic.violations.find(v => v.constraint_id === 'state_mutex');
    expect(v).toBeDefined();
    expect(v!.location.node_index).toBe(0);
    expect(v!.location.field).toBe('state');
  });

  it('no_duplicate_state violation points to node 0→1 (at_hotel persists)', () => {
    const report = scorer.score(hk3dayBuggy);
    const v = report.deterministic.violations.find(v => v.constraint_id === 'no_duplicate_state');
    expect(v).toBeDefined();
    expect(v!.location.node_index).toBe(0);
    expect(v!.location.node_index_end).toBe(1);
  });
});

describe('P0 acceptance 4.5 — deterministic check coverage', () => {
  const contract = loadContract(CONTRACT_PATH);
  const scorer = compileContract(contract);

  it('scorer has 4 deterministic predicates and 2 deterministic rubrics', () => {
    expect(scorer.deterministicPredicateCount).toBe(4);
    expect(scorer.deterministicRubricCount).toBe(2);
  });

  it('deterministic rubric scores include cost_fit and source_trust', () => {
    const report = scorer.score(hk3dayGolden);
    const dims = report.deterministic.rubric_scores.map(r => r.dim);
    expect(dims).toContain('cost_fit');
    expect(dims).toContain('source_trust');
    expect(dims).not.toContain('routing');     // judge,Part 2
    expect(dims).not.toContain('memorability'); // judge,Part 2
    expect(dims).not.toContain('dining_fit');   // judge,Part 2
  });
});
