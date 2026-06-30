/**
 * Crucible Live Env — FixtureEventSource。
 * spec ref: 2026-06-30-crucible-live-env-design.md §3.2, §8.2 (L3 兜底)
 *
 * 最简事件源:全部事件立刻 yield,无节奏控制。
 * 用途:
 *   1. L3 配额超限/连续失败时,LLMEventSource 切到此源兜底(spec §8.2)
 *   2. 单测的 deterministic 事件源
 */
import type { EventSource, LiveEnvEvent } from '../types.js';

export function createFixtureEventSource(events: LiveEnvEvent[]): EventSource {
  return {
    name: 'fixture',
    async *stream(_scenario: string, signal: AbortSignal): AsyncIterable<LiveEnvEvent> {
      for (const e of events) {
        if (signal.aborted) return;
        yield e;
      }
    },
  };
}
