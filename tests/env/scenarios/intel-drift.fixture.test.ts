import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LiveEnvEvent } from '../../../src/env/types.js';
import { loadContract } from '../../../src/contract/validate.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const INTEL_FIXTURE = join(__dirname, '..', '..', '..', 'src', 'env', 'scenarios', 'intel-drift.recorded.jsonl');
const INTEL_CONTRACT = join(__dirname, '..', '..', '..', 'contracts', 'intel-table-v1.yaml');

describe('intel-drift recorded fixture', () => {
  const lines = readFileSync(INTEL_FIXTURE, 'utf8').trim().split('\n');
  const events = lines.map(l => LiveEnvEvent.parse(JSON.parse(l)));

  it('has 3 events', () => {
    expect(events).toHaveLength(3);
  });

  it('all events scenario=intel-drift', () => {
    for (const e of events) expect(e.scenario).toBe('intel-drift');
  });

  it('t_offset_ms monotonically non-decreasing', () => {
    for (let i = 1; i < events.length; i++) {
      expect(events[i].t_offset_ms).toBeGreaterThanOrEqual(events[i - 1].t_offset_ms);
    }
  });

  it('all constraint_ids exist in intel-table contract', () => {
    const contract = loadContract(INTEL_CONTRACT);
    const validIds = new Set(contract.hard_constraints.map(c => c.id));
    for (const e of events) {
      if (e.kind === 'constraint_update') expect(validIds.has(e.constraint_id)).toBe(true);
    }
  });

  it('all target_fields exist in intel-table contract', () => {
    const contract = loadContract(INTEL_CONTRACT);
    const validFields = new Set(contract.fields.map(f => f.name));
    for (const e of events) {
      if (e.kind === 'info_drop') expect(validFields.has(e.target_field)).toBe(true);
    }
  });
});
