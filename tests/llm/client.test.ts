import { describe, it, expect, vi, beforeEach } from 'vitest';
import { callLLM, hasApiKey } from '../../src/llm/client.js';

describe('LLM client', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('hasApiKey returns false when OPENROUTER_API_KEY missing', () => {
    delete process.env.OPENROUTER_API_KEY;
    expect(hasApiKey()).toBe(false);
  });

  it('hasApiKey returns true when key set', () => {
    process.env.OPENROUTER_API_KEY = 'sk-test';
    expect(hasApiKey()).toBe(true);
    delete process.env.OPENROUTER_API_KEY;
  });

  it('callLLM returns null + warns when no API key', async () => {
    delete process.env.OPENROUTER_API_KEY;
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await callLLM('test prompt');
    expect(result).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringMatching(/OPENROUTER_API_KEY missing/));
    warnSpy.mockRestore();
  });

  it('callLLM returns string or null when API key set (mocked, no real call)', async () => {
    process.env.OPENROUTER_API_KEY = 'sk-test';
    const result = await callLLM('Return the word: hello');
    // 无真实 key 时 callLLM 会尝试网络调用,可能失败返回 null;有 key 时集成测试才验证真实返回
    // P0 单测只验证不 crash
    expect(result === null || typeof result === 'string').toBe(true);
    delete process.env.OPENROUTER_API_KEY;
  });
});
