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
      // compatibility: 'compatible' 强制用 /chat/completions(旧版 OpenAI API),
      // 兼容第三方服务(DeepSeek/火山方舟/vLLM 等只支持 chat completions)。
      compatibility: 'compatible',
    });
    const model = process.env.OPENAI_MODEL || 'gpt-4o';
    // 用 .chat() 而非默认的 .responses()(新版 API),
    // 第三方兼容服务只支持 /chat/completions,用 .responses() 会 404。
    // 注: reasoning models(如 deepseek-v4-flash)不支持 temperature,
    // 故不设 temperature 让模型用默认值(避免兼容性警告)。
    const result = await generateText({
      model: openai.chat(model),
      prompt,
    });
    return result.text;
  } catch (err) {
    console.warn(`[LLM] call failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}
