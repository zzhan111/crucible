/**
 * Crucible Live Env — LLMEventSource。
 * spec ref: 2026-06-30-crucible-live-env-design.md §3.2, §8.1, §8.2
 *
 * 调 LLM 生成事件,三层安全网:
 *   L1: zod 校验信封 + payload → 失败丢弃 + 计数
 *   L2: 语义校验(constraint_id 存在)→ 失败丢弃 + 计数
 *   L3: 配额超限(MAX_EVENTS)或连续失败(MAX_CONSECUTIVE_FAILURES)→ 切 FixtureEventSource
 *
 * 依赖注入 callFn:测试用 mock,生产用 callLLMJson。
 * emitted_by = 'llm';fallback 切换后 emitted_by = 'fixture'。
 *
 * FIX B3:t_offset_ms 用相对值(距 stream 开始的毫秒),而非绝对 epoch ms。
 * ReplayEventSource 以 prevT=0 起步按 (t_offset_ms - prevT) sleep,绝对时间戳会让首个事件
 * sleep ~1.7e12 ms 永久挂起。相对值保证录制的事件可正确回放。
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { ENV_CONST } from '../constants.js';
import type { EventSource, LiveEnvEvent } from '../types.js';
import { LiveEnvEvent as EventSchema } from '../types.js';
import { validateSemantics } from '../semantic-validator.js';
import type { Contract } from '../../contract/schema.js';
import type { Artifact } from '../../predicates/types.js';
import { createFixtureEventSource } from './fixture.js';

export interface LLMEventSourceOpts {
  scenario: string;
  contract: Contract;
  /** 依赖注入:默认 callLLMJson,测试用 mock */
  callFn: (prompt: string, opts: { temperature: number; seed: number; systemPrompt: string }) => Promise<Record<string, unknown> | null>;
  /** L3 兜底事件;未传则读 fallback.jsonl */
  fallbackEvents?: LiveEnvEvent[];
  /** 测试用:覆盖 MAX_EVENTS_PER_SCENARIO */
  maxEvents?: number;
}

export interface LLMStats {
  totalCalls: number;
  l1Failures: number;
  l2Failures: number;
  yielded: number;
  fellBack: boolean;
}

export function createLLMEventSource(opts: LLMEventSourceOpts): EventSource & { getStats(): LLMStats } {
  const maxEvents = opts.maxEvents ?? ENV_CONST.MAX_EVENTS_PER_SCENARIO;
  const maxFailures = ENV_CONST.MAX_CONSECUTIVE_FAILURES;
  const stats: LLMStats = { totalCalls: 0, l1Failures: 0, l2Failures: 0, yielded: 0, fellBack: false };

  // 加载 system prompt(懒加载)
  let systemPrompt: string | null = null;
  function getSystemPrompt(): string {
    if (systemPrompt === null) {
      try {
        systemPrompt = readFileSync(ENV_CONST.LLM_SYSTEM_PROMPT_PATH, 'utf8');
      } catch {
        systemPrompt = ''; // 文件缺失不 crash,空 prompt
      }
    }
    return systemPrompt;
  }

  return {
    name: 'llm',
    async *stream(scenario: string, signal: AbortSignal): AsyncIterable<LiveEnvEvent> {
      // FIX B3:相对时间锚点。t_offset_ms = Date.now() - t0,从 ~0 起步单调递增。
      const t0 = Date.now();
      let yielded = 0;
      let consecutiveFailures = 0;

      while (!signal.aborted) {
        if (yielded >= maxEvents) {
          // L3 配额超限 → 切 fallback
          stats.fellBack = true;
          yield* fixtureFallback(scenario, signal, opts);
          return;
        }

        const payload = await opts.callFn(
          `Generate one drift event for scenario "${scenario}". Output one JSON object per the system prompt.`,
          { temperature: ENV_CONST.LLM_TEMPERATURE, seed: ENV_CONST.LLM_SEED, systemPrompt: getSystemPrompt() }
        );

        if (payload === null) {
          // callFn 返回 null(LLM 无 key / 出错 / 自然结束)→ 结束流
          return;
        }

        // 计数:仅对返回了 payload 的调用计 totalCalls。
        // 不变量:totalCalls = l1Failures + l2Failures + yielded。
        stats.totalCalls++;

        // L1: zod 校验
        const envelope = {
          id: randomUUID(),
          scenario,
          t_offset_ms: Date.now() - t0, // FIX B3:相对 ms,可回放
          emitted_by: 'llm' as const,
          ...payload,
        };
        const l1 = EventSchema.safeParse(envelope);
        if (!l1.success) {
          stats.l1Failures++;
          consecutiveFailures++;
          if (consecutiveFailures >= maxFailures) {
            stats.fellBack = true;
            yield* fixtureFallback(scenario, signal, opts);
            return;
          }
          continue;
        }

        // L2: 语义校验(只用 contract,不需要 artifact;subject/locator 在 consume 时重校)
        const l2 = validateSemantics(l1.data, {
          artifact: { family: opts.contract.artifact_family, nodes: [] } as Artifact,
          contract: opts.contract,
        });
        if (!l2.ok && l1.data.kind === 'constraint_update') {
          // constraint_update 的 L2 不依赖 artifact,失败 = 真无效
          stats.l2Failures++;
          consecutiveFailures++;
          if (consecutiveFailures >= maxFailures) {
            stats.fellBack = true;
            yield* fixtureFallback(scenario, signal, opts);
            return;
          }
          continue;
        }

        // 通过 → yield
        consecutiveFailures = 0;
        stats.yielded++;
        yielded++;
        yield l1.data;
      }
    },
    getStats() {
      return { ...stats };
    },
  };
}

async function* fixtureFallback(
  scenario: string,
  signal: AbortSignal,
  opts: LLMEventSourceOpts
): AsyncIterable<LiveEnvEvent> {
  const events = opts.fallbackEvents ?? [];
  const fixture = createFixtureEventSource(events);
  yield* fixture.stream(scenario, signal);
}
