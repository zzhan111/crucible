import { describe, it, expect, vi } from 'vitest';
import { createLLMEventSource } from '../../../src/env/event-source/llm.js';
import type { LiveEnvEvent } from '../../../src/env/types.js';

// mock callFn:返回合法事件 JSON
function mkValidEvent(id: string): Record<string, unknown> {
  return { kind: 'constraint_update', constraint_id: 'time_budget', new_threshold: 500, reason: 'test' };
}

describe('LLMEventSource', () => {
  it('name is llm', () => {
    const src = createLLMEventSource({
      scenario: 'travel-drift',
      contract: { hard_constraints: [{ id: 'time_budget' }] } as any,
      callFn: async () => mkValidEvent('1'),
    });
    expect(src.name).toBe('llm');
  });

  it('yields valid events from callFn', async () => {
    let count = 0;
    const src = createLLMEventSource({
      scenario: 'travel-drift',
      contract: { hard_constraints: [{ id: 'time_budget' }] } as any,
      callFn: async () => {
        count++;
        return count <= 2 ? mkValidEvent(String(count)) : null; // 第三次返回 null = 结束
      },
    });
    const out: LiveEnvEvent[] = [];
    for await (const e of src.stream('travel-drift', new AbortController().signal)) {
      out.push(e);
    }
    expect(out).toHaveLength(2);
    expect(out[0].emitted_by).toBe('llm');
  });

  it('L1: skips events that fail zod validation', async () => {
    let count = 0;
    const src = createLLMEventSource({
      scenario: 'travel-drift',
      contract: { hard_constraints: [{ id: 'time_budget' }] } as any,
      callFn: async () => {
        count++;
        if (count === 1) return { kind: 'disruption', reason: 'r' }; // 缺 subject/severity → zod fail
        return null;
      },
    });
    const out: LiveEnvEvent[] = [];
    for await (const e of src.stream('travel-drift', new AbortController().signal)) out.push(e);
    expect(out).toHaveLength(0);
  });

  it('L2: skips events with unknown constraint_id', async () => {
    let count = 0;
    const src = createLLMEventSource({
      scenario: 'travel-drift',
      contract: { hard_constraints: [{ id: 'time_budget' }] } as any,
      callFn: async () => {
        count++;
        if (count === 1) return { kind: 'constraint_update', constraint_id: 'mystery', new_threshold: 1, reason: 'r' };
        return null;
      },
    });
    const out: LiveEnvEvent[] = [];
    for await (const e of src.stream('travel-drift', new AbortController().signal)) out.push(e);
    expect(out).toHaveLength(0);
  });

  it('L3: switches to fixture fallback after MAX_CONSECUTIVE_FAILURES', async () => {
    let count = 0;
    const fallbackEvents: LiveEnvEvent[] = [{
      id: '550e8400-e29b-41d4-a716-4466554400fb', scenario: 'travel-drift', t_offset_ms: 0, emitted_by: 'fixture',
      kind: 'constraint_update', constraint_id: 'time_budget', new_threshold: 960, reason: 'fallback',
    }];
    const src = createLLMEventSource({
      scenario: 'travel-drift',
      contract: { hard_constraints: [{ id: 'time_budget' }] } as any,
      callFn: async () => { count++; return { kind: 'bad' }; }, // 永远返回非法
      fallbackEvents,
    });
    const out: LiveEnvEvent[] = [];
    for await (const e of src.stream('travel-drift', new AbortController().signal)) out.push(e);
    // 3 次失败后切 fallback,fallback 有 1 个事件
    expect(out).toHaveLength(1);
    expect(out[0].emitted_by).toBe('fixture');
  });

  it('L3: switches to fixture after MAX_EVENTS_PER_SCENARIO reached', async () => {
    let count = 0;
    const src = createLLMEventSource({
      scenario: 'travel-drift',
      contract: { hard_constraints: [{ id: 'time_budget' }] } as any,
      callFn: async () => {
        count++;
        return count <= 10 ? mkValidEvent(String(count)) : null; // 超过 8
      },
      fallbackEvents: [],
      maxEvents: 8, // 测试用小值
    });
    const out: LiveEnvEvent[] = [];
    for await (const e of src.stream('travel-drift', new AbortController().signal)) out.push(e);
    expect(out.length).toBeLessThanOrEqual(8);
  });

  it('respects abort signal', async () => {
    const ac = new AbortController();
    let callCount = 0;
    const src = createLLMEventSource({
      scenario: 'travel-drift',
      contract: { hard_constraints: [{ id: 'time_budget' }] } as any,
      callFn: async () => {
        callCount++;
        if (callCount === 1) { ac.abort(); }
        return mkValidEvent('1');
      },
    });
    const out: LiveEnvEvent[] = [];
    try {
      for await (const e of src.stream('travel-drift', ac.signal)) out.push(e);
    } catch { /* abort */ }
    expect(out.length).toBeLessThanOrEqual(1);
  });

  it('callFn returning null ends stream gracefully', async () => {
    const src = createLLMEventSource({
      scenario: 'travel-drift',
      contract: { hard_constraints: [{ id: 'time_budget' }] } as any,
      callFn: async () => null,
    });
    const out: LiveEnvEvent[] = [];
    for await (const e of src.stream('travel-drift', new AbortController().signal)) out.push(e);
    expect(out).toHaveLength(0);
  });

  it('records metrics (l1Failures, l2Failures, totalCalls)', async () => {
    let count = 0;
    const src = createLLMEventSource({
      scenario: 'travel-drift',
      contract: { hard_constraints: [{ id: 'time_budget' }] } as any,
      callFn: async () => {
        count++;
        if (count === 1) return { kind: 'bad' }; // L1 fail
        if (count === 2) return { kind: 'constraint_update', constraint_id: 'mystery', new_threshold: 1, reason: 'r' }; // L2 fail
        return null;
      },
    });
    for await (const _e of src.stream('travel-drift', new AbortController().signal)) { /* */ }
    const stats = src.getStats();
    expect(stats.l1Failures).toBe(1);
    expect(stats.l2Failures).toBe(1);
    expect(stats.totalCalls).toBe(2);
  });
});
