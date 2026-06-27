import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createMastraAgent, isMastraRuntimeActive, type MastraBackedAgent } from '../../src/agents/mastra-adapter.js';

const FLAG = 'CRUCIBLE_USE_MASTRA';

describe('P3.5 §2.1.1 Mastra adapter', () => {
  const orig = process.env[FLAG];

  beforeEach(() => {
    delete process.env[FLAG];
  });

  afterEach(() => {
    if (orig === undefined) delete process.env[FLAG];
    else process.env[FLAG] = orig;
  });

  it('isMastraRuntimeActive 默认 false', () => {
    expect(isMastraRuntimeActive()).toBe(false);
  });

  it('默认(无 flag)返回结构兼容 SimpleAgent 的 facade,不挂 getMastraAgent', () => {
    const a = createMastraAgent('judge', 'instructions');
    expect(a.name).toBe('judge');
    expect(a.instructions).toBe('instructions');
    expect(a.getMastraAgent).toBeUndefined();
  });

  it('CRUCIBLE_USE_MASTRA=1 时 facade 挂载 getMastraAgent 且保留 name/instructions', () => {
    process.env[FLAG] = '1';
    expect(isMastraRuntimeActive()).toBe(true);
    const a: MastraBackedAgent = createMastraAgent('scorer', 'scorer instructions');
    expect(a.name).toBe('scorer');
    expect(a.instructions).toBe('scorer instructions');
    expect(typeof a.getMastraAgent).toBe('function');
  });

  it('getMastraAgent 返回真实 Mastra Agent 实例(需 model)', () => {
    process.env[FLAG] = '1';
    const a = createMastraAgent('contract-author', 'revise instructions');
    // 用最小 mock model 满足 Mastra Agent 构造(不调用 generate)
    const fakeModel = { id: 'mock', provider: 'mock', doGenerate: () => Promise.resolve({}) };
    const inst = a.getMastraAgent!(fakeModel);
    expect(inst).toBeDefined();
    // Mastra Agent 实例应有 generate/stream 等方法
    expect(typeof (inst as { generate?: unknown }).generate).toBe('function');
  });

  it('getMastraAgent 对同一 (name,instructions) memoize 同一实例', () => {
    process.env[FLAG] = '1';
    const a1 = createMastraAgent('judge', 'same instructions');
    const a2 = createMastraAgent('judge', 'same instructions');
    const fakeModel = { id: 'mock', provider: 'mock', doGenerate: () => Promise.resolve({}) };
    const inst1 = a1.getMastraAgent!(fakeModel);
    const inst2 = a2.getMastraAgent!(fakeModel);
    expect(inst1).toBe(inst2); // WeakMap memoize
  });
});
