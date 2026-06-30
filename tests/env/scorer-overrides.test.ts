import { describe, it, expect } from 'vitest';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadContract } from '../../src/contract/validate.js';
import { compileContract } from '../../src/contract/compiler.js';
import type { Artifact } from '../../src/predicates/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONTRACT_PATH = join(__dirname, '..', '..', 'contracts', 'travel-sequence-v1.yaml');

// 一个超 960 分钟的 artifact(默认阈值下会违规)
const overBudget: Artifact = {
  family: 'sequence',
  metadata: { day: 1, daily_available_minutes: 960 },
  nodes: [
    { time_block: '08:00', action: 'a', node_type: 'core_experience', duration_min: 500, elasticity: 'non_compressible' },
    { time_block: '16:00', action: 'b', node_type: 'core_experience', duration_min: 500, elasticity: 'non_compressible' },
  ],
};

describe('runtime_overrides on time_budget', () => {
  it('without overrides: over-budget artifact violates time_budget', () => {
    const contract = loadContract(CONTRACT_PATH);
    const scorer = compileContract(contract);
    const report = scorer.score(overBudget);
    const violations = report.deterministic.violations.filter(v => v.constraint_id === 'time_budget');
    expect(violations.length).toBeGreaterThan(0);
  });

  it('with overrides raising threshold to 1200: no time_budget violation', () => {
    const contract = loadContract(CONTRACT_PATH);
    const scorer = compileContract(contract);
    const withOverride: Artifact = {
      ...overBudget,
      metadata: { ...overBudget.metadata, runtime_overrides: { time_budget: 1200 } },
    };
    const report = scorer.score(withOverride);
    const violations = report.deterministic.violations.filter(v => v.constraint_id === 'time_budget');
    expect(violations).toHaveLength(0);
  });
});
