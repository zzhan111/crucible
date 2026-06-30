import { createOpenAI } from '@ai-sdk/openai';
import { generateText } from 'ai';

export type ModelTier = 'fast' | 'slow';

// 模块级去重 flag:进程内只 warn 1 次"slow tier 降级"
let slowFallbackWarned = false;

/**
 * resolveModel: 按 tier 路由模型名。纯函数(除首次 slow 降级 warning)。
 * - 'fast' → OPENAI_MODEL || 'gpt-4o'
 * - 'slow' → OPENAI_MODEL_SLOW || OPENAI_MODEL || 'gpt-4o'(并 warn 1 次)
 *
 * 灵感:MIRA Nature 论文按"决策影响半径"分层(GPT-4o 执行 + o1 规划)。
 * 决议来源:docs/superpowers/specs/2026-06-30-llm-tier-routing-design.md
 */
export function resolveModel(tier: ModelTier): string {
  const fast = process.env.OPENAI_MODEL || 'gpt-4o';
  if (tier === 'fast') return fast;
  const slow = process.env.OPENAI_MODEL_SLOW;
  if (slow) return slow;
  if (!slowFallbackWarned) {
    console.warn(
      '[LLM] tier=slow not configured, falling back to fast (set OPENAI_MODEL_SLOW to enable)'
    );
    slowFallbackWarned = true;
  }
  return fast;
}

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

export interface LLMJsonOptions {
  temperature?: number;
  seed?: number;
  systemPrompt?: string;
}

/**
 * Pure JSON parser for LLM text output. Trims, strips ```json fences,
 * parses, and returns null on empty input or parse failure.
 *
 * Exported so tests can exercise the parsing logic without invoking the SDK.
 */
export function parseLLMJson(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const cleaned = trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  if (!cleaned) return null;
  try {
    return JSON.parse(cleaned) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * 结构化 JSON 输出变体。复用 createOpenAI 模式,但:
 * - 传 temperature/seed(录制期需要,不影响 judge 的 callLLM)
 * - 解析返回文本为 JSON(parseLLMJson),失败返回 null
 * - 无 API key / 出错 → null(同 callLLM 降级模式)
 *
 * 注:reasoning model 可能不支持 temperature;调用方传了就传,SDK 会忽略或报错——
 * 报错走 catch 返回 null,不 crash。
 */
export async function callLLMJson(
  prompt: string,
  opts: LLMJsonOptions = {}
): Promise<Record<string, unknown> | null> {
  if (!hasApiKey()) {
    console.warn('[LLM] OPENAI_API_KEY missing, callLLMJson returns null');
    return null;
  }
  try {
    const openai = createOpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      baseURL: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
    });
    const model = process.env.OPENAI_MODEL || 'gpt-4o';
    const result = await generateText({
      model: openai.chat(model),
      ...(opts.systemPrompt ? { system: opts.systemPrompt } : {}),
      prompt,
      ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
      ...(opts.seed !== undefined ? { seed: opts.seed } : {}),
    });
    return parseLLMJson(result.text);
  } catch (err) {
    console.warn(`[LLM] callLLMJson failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}
