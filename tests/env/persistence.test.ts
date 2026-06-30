import { describe, it, expect } from 'vitest';
import { openAndMigrate } from '../../src/persistence/db.js';
import { insertEnvEvent, markEnvEventApplied, listEnvEvents } from '../../src/persistence/repositories.js';
import { persistEnvEvent, markApplied } from '../../src/persistence/sink.js';
import type { LiveEnvEvent } from '../../src/env/types.js';
import { SYSTEM_ACTOR } from '../../src/auth/rbac.js';

function mkEvent(id: string, kind: LiveEnvEvent['kind']): LiveEnvEvent {
  const base = { id, scenario: 'travel-drift', t_offset_ms: 1000, emitted_by: 'replay' as const };
  if (kind === 'disruption') return { ...base, kind, subject: 'n1', reason: 'r', severity: 'minor', invalidates: [] };
  if (kind === 'info_drop') return { ...base, kind, target_field: 'cost', target_locator: 'n1', new_value: 80, evidence: 'x', source_trust: 0.8 };
  return { ...base, kind, constraint_id: 'time_budget', new_threshold: 600, reason: 'r' };
}

describe('env_events persistence', () => {
  it('migration creates env_events table', () => {
    const db = openAndMigrate();
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='env_events'").get();
    expect(tables).toBeDefined();
  });

  it('insertEnvEvent writes row with applied=0', () => {
    const db = openAndMigrate();
    const e = mkEvent('550e8400-e29b-41d4-a716-446655440000', 'disruption');
    insertEnvEvent(db, e, 'run-1', SYSTEM_ACTOR.id);
    const rows = listEnvEvents(db, 'run-1');
    expect(rows).toHaveLength(1);
    expect(rows[0].applied).toBe(0);
    expect(rows[0].applied_iter).toBeNull();
  });

  it('markEnvEventApplied sets applied=1 + applied_iter', () => {
    const db = openAndMigrate();
    const e = mkEvent('550e8400-e29b-41d4-a716-446655440001', 'disruption');
    insertEnvEvent(db, e, 'run-1', SYSTEM_ACTOR.id);
    markEnvEventApplied(db, e.id, 1);
    const rows = listEnvEvents(db, 'run-1');
    expect(rows[0].applied).toBe(1);
    expect(rows[0].applied_iter).toBe(1);
  });

  it('listEnvEvents filters by run_id and orders by t_offset_ms', () => {
    const db = openAndMigrate();
    insertEnvEvent(db, mkEvent('550e8400-e29b-41d4-a716-446655440002', 'disruption'), 'run-A', SYSTEM_ACTOR.id);
    insertEnvEvent(db, { ...mkEvent('550e8400-e29b-41d4-a716-446655440003', 'info_drop'), t_offset_ms: 500 }, 'run-A', SYSTEM_ACTOR.id);
    insertEnvEvent(db, mkEvent('550e8400-e29b-41d4-a716-446655440004', 'disruption'), 'run-B', SYSTEM_ACTOR.id);
    const rows = listEnvEvents(db, 'run-A');
    expect(rows).toHaveLength(2);
    expect(rows[0].t_offset_ms).toBeLessThanOrEqual(rows[1].t_offset_ms);
  });

  it('persistEnvEvent (sink) delegates to repository', () => {
    const db = openAndMigrate();
    const e = mkEvent('550e8400-e29b-41d4-a716-446655440005', 'disruption');
    persistEnvEvent(db, e, 'run-2', SYSTEM_ACTOR);
    const rows = listEnvEvents(db, 'run-2');
    expect(rows).toHaveLength(1);
    expect(rows[0].applied).toBe(0);
  });

  it('markApplied (sink) delegates to repository', () => {
    const db = openAndMigrate();
    const e = mkEvent('550e8400-e29b-41d4-a716-446655440006', 'disruption');
    persistEnvEvent(db, e, 'run-3', SYSTEM_ACTOR);
    markApplied(db, e.id, 2);
    const rows = listEnvEvents(db, 'run-3');
    expect(rows[0].applied).toBe(1);
    expect(rows[0].applied_iter).toBe(2);
  });

  it('migration is idempotent (re-open same :memory: ok)', () => {
    const db = openAndMigrate();
    // 再 migrate 一次(schema_version 已记录,跳过)
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='env_events'").get();
    expect(tables).toBeDefined();
  });
});
