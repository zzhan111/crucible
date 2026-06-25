import { createOpenAI } from '@ai-sdk/openai';
import { generateText } from 'ai';

export function hasApiKey(): boolean {
  return !!process.env.OPENAI_API_KEY;
}

/**
 * callLLM: 封装 Vercel AI SDK + OpenAI 兼容 provider。
 * 支持任意 OpenAI 格式 endpoint(OpenAI 官方 / Azure / vLLM / 火山方舟等)。
 * 无 API key 时返回 null + 警告(降级模式)。
 * 出错时返回 null + 警告,不 crash workflow。
 */
export async function callLLM(prompt: string): Promise<string | null> {
  if (!hasApiKey()) {
    console.warn('[LLM] OPENAI_API_KEY missing, judge will use neutral 0.5');
    return null;
  }
  try {
    const openai = createOpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      baseURL: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
    });
    const model = process.env.OPENAI_MODEL || 'gpt-4o';
    const result = await generateText({
      model: openai(model),
      prompt,
      temperature: 0.2,
    });
    return result.text;
  } catch (err) {
    console.warn(`[LLM] call failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}
