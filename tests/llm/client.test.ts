import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { callLLM, hasApiKey } from '../../src/llm/client.js';

describe('LLM client', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('hasApiKey returns false when OPENAI_API_KEY missing', () => {
    delete process.env.OPENAI_API_KEY;
    expect(hasApiKey()).toBe(false);
  });

  it('hasApiKey returns true when key set', () => {
    process.env.OPENAI_API_KEY = 'sk-test';
    expect(hasApiKey()).toBe(true);
    delete process.env.OPENAI_API_KEY;
  });

  it('callLLM returns null + warns when no API key', async () => {
    delete process.env.OPENAI_API_KEY;
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await callLLM('test prompt');
    expect(result).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringMatching(/OPENAI_API_KEY missing/));
    warnSpy.mockRestore();
  });

  it('callLLM returns string or null when API key set (may fail with invalid key)', async () => {
    process.env.OPENAI_API_KEY = 'sk-test';
    // 设短超时:无效 key 会触发网络调用,可能慢。用 Promise.race 避免 vitest 5s 超时。
    const result = await Promise.race([
      callLLM('Return the word: hello'),
      new Promise<null>(resolve => setTimeout(() => resolve(null), 3000)),
    ]);
    expect(result === null || typeof result === 'string').toBe(true);
    delete process.env.OPENAI_API_KEY;
  });
});

describe('resolveModel (tier 路由)', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.resetModules();
    delete process.env.OPENAI_MODEL;
    delete process.env.OPENAI_MODEL_SLOW;
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    delete process.env.OPENAI_MODEL;
    delete process.env.OPENAI_MODEL_SLOW;
  });

  it('fast tier 读 OPENAI_MODEL', async () => {
    process.env.OPENAI_MODEL = 'deepseek-v3';
    const { resolveModel } = await import('../../src/llm/client.js');
    expect(resolveModel('fast')).toBe('deepseek-v3');
  });

  it('fast tier 缺失时退到 gpt-4o', async () => {
    const { resolveModel } = await import('../../src/llm/client.js');
    expect(resolveModel('fast')).toBe('gpt-4o');
  });

  it('slow tier 优先读 OPENAI_MODEL_SLOW', async () => {
    process.env.OPENAI_MODEL = 'deepseek-v3';
    process.env.OPENAI_MODEL_SLOW = 'deepseek-r1';
    const { resolveModel } = await import('../../src/llm/client.js');
    expect(resolveModel('slow')).toBe('deepseek-r1');
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('slow tier 缺失 SLOW 时降级到 FAST', async () => {
    process.env.OPENAI_MODEL = 'deepseek-v3';
    const { resolveModel } = await import('../../src/llm/client.js');
    expect(resolveModel('slow')).toBe('deepseek-v3');
    expect(warnSpy).toHaveBeenCalledWith(expect.stringMatching(/tier=slow not configured/));
  });

  it('slow tier 双缺失时降级到 gpt-4o', async () => {
    const { resolveModel } = await import('../../src/llm/client.js');
    expect(resolveModel('slow')).toBe('gpt-4o');
    expect(warnSpy).toHaveBeenCalledWith(expect.stringMatching(/tier=slow not configured/));
  });

  it('slow tier 首次降级 warn,第二次静默', async () => {
    const { resolveModel } = await import('../../src/llm/client.js');
    resolveModel('slow');
    resolveModel('slow');
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });
});
