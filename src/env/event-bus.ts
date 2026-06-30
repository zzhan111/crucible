/**
 * Crucible Live Env — 内存事件总线。
 * spec ref: 2026-06-30-crucible-live-env-design.md §3.3
 *
 * 两个消费模式互不干扰:
 *   - subscribe: UI 用(SSE 推送),可多订阅
 *   - drain:     Workflow 用(轮间一次性拿走未消费事件)
 * 两者读同一份 in-memory log,只是 drain 多维护一个"未消费指针"。
 *
 * subscribe handler 抛错不影响其他订阅者(隔离)。
 */
import type { EventBus, LiveEnvEvent } from './types.js';

export function createEventBus(): EventBus {
  const log: LiveEnvEvent[] = [];
  const subscribers = new Set<(e: LiveEnvEvent) => void>();
  let drainPointer = 0;

  return {
    publish(event: LiveEnvEvent): void {
      log.push(event);
      for (const handler of subscribers) {
        try {
          handler(event);
        } catch {
          // 一个订阅者抛错不影响其他订阅者(隔离,spec §4.2)
        }
      }
    },

    subscribe(handler: (e: LiveEnvEvent) => void): () => void {
      subscribers.add(handler);
      return () => subscribers.delete(handler);
    },

    drain(): LiveEnvEvent[] {
      const pending = log.slice(drainPointer);
      drainPointer = log.length;
      return pending;
    },

    snapshot(): readonly LiveEnvEvent[] {
      return log;
    },
  };
}
