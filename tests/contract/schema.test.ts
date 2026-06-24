import { describe, it, expect } from 'vitest';
import { ContractSchema, type Contract } from '../../src/contract/schema.js';

describe('ContractSchema', () => {
  it('parses a valid sequence contract', () => {
    const raw = {
      artifact_family: 'sequence',
      fields: [
        { name: 'time_block', type: 'string', required: true },
        { name: 'node_type', type: 'enum', required: true, values: ['hard', 'transit'] },
      ],
      hard_constraints: [
        { id: 'continuity', type: 'declarative', rule: 'adjacent must have transit' },
      ],
      rubric: [
        { dim: 'cost_fit', weight: 1.0, mode: 'deterministic' },
      ],
      calibration: {
        frozen_golden_set: 'golden/hk.jsonl',
        metric: 'kendall_tau',
      },
    };
    const result = ContractSchema.parse(raw);
    expect(result.artifact_family).toBe('sequence');
    expect(result.fields).toHaveLength(2);
    expect(result.hard_constraints).toHaveLength(1);
    expect(result.rubric[0].weight).toBe(1.0);
  });

  it('rejects rubric weights not summing to 1.0', () => {
    const raw = {
      artifact_family: 'sequence',
      fields: [{ name: 'x', type: 'string', required: true }],
      hard_constraints: [],
      rubric: [
        { dim: 'a', weight: 0.3, mode: 'deterministic' },
        { dim: 'b', weight: 0.3, mode: 'deterministic' },
      ],
      calibration: { frozen_golden_set: 'x', metric: 'kendall_tau' },
    };
    expect(() => ContractSchema.parse(raw)).toThrow();
  });

  it('rejects unknown artifact_family', () => {
    const raw = {
      artifact_family: 'bogus',
      fields: [],
      hard_constraints: [],
      rubric: [],
      calibration: { frozen_golden_set: 'x', metric: 'kendall_tau' },
    };
    expect(() => ContractSchema.parse(raw)).toThrow();
  });
});
