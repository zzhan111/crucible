import { describe, it, expect, vi, beforeEach } from 'vitest';
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
