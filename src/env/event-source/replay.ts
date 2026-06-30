/**
 * Crucible Live Env — ReplayEventSource。
 * spec ref: 2026-06-30-crucible-live-env-design.md §3.2, §4.1
 *
 * 从 JSONL 文件回放事件,按 t_offset_ms 控制节奏(相对 scenario 开始的毫秒)。
 * 路演现场默认事件源:看起来像 LLM 实时生成,实际从录像回放。
 *
 * 文件格式:每行一个 LiveEnvEvent JSON。
 * 启动期 fail-fast:文件不存在 → throw;行解析失败 → throw。
 * scenario 过滤:只 yield scenario 匹配的事件(允许一个 JSONL 含多 scenario)。
 */
import { readFileSync } from 'node:fs';
import type { EventSource, LiveEnvEvent } from '../types.js';
import { LiveEnvEvent as EventSchema } from '../types.js';

export function createReplayEventSource(jsonlPath: string): EventSource {
  return {
    name: 'replay',
    async *stream(scenario: string, signal: AbortSignal): AsyncIterable<LiveEnvEvent> {
      // 读 + 解析(fail-fast:文件缺失/格式错都抛)
      const raw = readFileSync(jsonlPath, 'utf8');
      const lines = raw.split('\n').filter(l => l.trim().length > 0);
      const events: LiveEnvEvent[] = [];
      for (const line of lines) {
        const parsed = JSON.parse(line); // malformed → throw
        const validated = EventSchema.safeParse(parsed);
        if (!validated.success) {
          throw new Error(`ReplayEventSource: invalid event in ${jsonlPath}: ${validated.error.message}`);
        }
        events.push(validated.data);
      }

      // 按 scenario 过滤 + t_offset_ms 排序
      const filtered = events
        .filter(e => e.scenario === scenario)
        .sort((a, b) => a.t_offset_ms - b.t_offset_ms);

      let prevT = 0;
      for (const e of filtered) {
        if (signal.aborted) return;
        const delay = e.t_offset_ms - prevT;
        if (delay > 0) {
          await sleep(delay, signal);
        }
        if (signal.aborted) return;
        prevT = e.t_offset_ms;
        yield e;
      }
    },
  };
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}
