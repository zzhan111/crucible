import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { generateText } from 'ai';

export function hasApiKey(): boolean {
  return !!process.env.OPENROUTER_API_KEY;
}

/**
 * callLLM: 封装 Vercel AI SDK + OpenRouter。
 * 无 API key 时返回 null + 警告(降级模式,spec §8)。
 * 出错时返回 null + 警告,不 crash workflow。
 */
export async function callLLM(prompt: string): Promise<string | null> {
  if (!hasApiKey()) {
    console.warn('[LLM] OPENROUTER_API_KEY missing, judge will use neutral 0.5');
    return null;
  }
  try {
    const openrouter = createOpenRouter({
      apiKey: process.env.OPENROUTER_API_KEY,
    });
    const model = process.env.OPENROUTER_MODEL || 'anthropic/claude-3-5-sonnet';
    const result = await generateText({
      model: openrouter(model),
      prompt,
      temperature: 0.2,
    });
    return result.text;
  } catch (err) {
    console.warn(`[LLM] call failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}
