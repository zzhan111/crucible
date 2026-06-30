import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { parseLLMJson, callLLMJson } from '../../src/llm/client.js';

describe('parseLLMJson', () => {
  it('parses a plain JSON object', () => {
    expect(parseLLMJson('{"kind":"disruption","subject":"n1"}')).toEqual({
      kind: 'disruption',
      subject: 'n1',
    });
  });

  it('parses markdown-fenced JSON', () => {
    expect(parseLLMJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it('returns null for non-JSON text', () => {
    expect(parseLLMJson('not json')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(parseLLMJson('')).toBeNull();
  });
});

describe('callLLMJson', () => {
  let savedKey: string | undefined;
  beforeEach(() => {
    savedKey = process.env.OPENAI_API_KEY;
  });
  afterEach(() => {
    if (savedKey !== undefined) process.env.OPENAI_API_KEY = savedKey;
    else delete process.env.OPENAI_API_KEY;
  });

  it('returns null + warns when no OPENAI_API_KEY', async () => {
    delete process.env.OPENAI_API_KEY;
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await callLLMJson('prompt', { temperature: 0.3, seed: 42 });
    expect(result).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringMatching(/OPENAI_API_KEY missing/));
    warnSpy.mockRestore();
  });
});
