/**
 * Crucible Live Env — 公开 API。
 * spec ref: 2026-06-30-crucible-live-env-design.md §3.4, §4
 *
 * startLiveEnv() 组装:EventSource → EventBus → consumer。
 * mode='replay':从 JSONL 回放(路演默认)
 * mode='record':LLM 录制(Plan 2 实现;此处先 throw not implemented)
 *
 * EnvHandle.consume() 是 workflow 接线点:drain bus → consumeEvents → 返回新 artifact。
 */
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import type { Artifact } from '../predicates/types.js';
import type { Contract } from '../contract/schema.js';
import type { EnvHandle, EventBus, EventSource, LiveEnvEvent } from './types.js';

/** §5: workflow 接线点 — 重新导出,供 src/workflow/crucible.ts 通过 env 入口引入。 */
export type { EnvHandle } from './types.js';
import { createEventBus } from './event-bus.js';
import { createReplayEventSource } from './event-source/replay.js';
import { createLLMEventSource } from './event-source/llm.js';
import { consumeEvents } from './consumer.js';
import { validateSemantics } from './semantic-validator.js';
import { callLLMJson } from '../llm/client.js';

export interface StartLiveEnvOpts {
  scenario: string;
  mode: 'replay' | 'record';
  fixturePath?: string;       // replay 模式:JSONL 路径;record 模式:输出路径
  contract: Contract;          // consumer + L2 校验需要
  auditDb?: import('../persistence/db.js').DB;  // 可选,落库 env_events
  /** record 模式:注入 callFn(测试用);默认用 callLLMJson */
  callFn?: (prompt: string, opts: { temperature: number; seed: number; systemPrompt: string }) => Promise<Record<string, unknown> | null>;
  /** record 模式:最大事件数(测试用) */
  maxEvents?: number;
}

export async function startLiveEnv(opts: StartLiveEnvOpts): Promise<EnvHandle> {
  const bus = createEventBus();
  const runId = randomUUID();
  const contract = opts.contract;

  let source: EventSource;
  if (opts.mode === 'replay') {
    if (!opts.fixturePath) throw new Error('startLiveEnv: replay mode requires fixturePath');
    source = createReplayEventSource(opts.fixturePath);
  } else {
    // record 模式 = LLMEventSource
    if (!opts.fixturePath) throw new Error('startLiveEnv: record mode requires fixturePath (output JSONL path)');
    const callFn = opts.callFn ?? (async (prompt: string, o: { temperature: number; seed: number; systemPrompt: string }) =>
      callLLMJson(prompt, { temperature: o.temperature, seed: o.seed, systemPrompt: o.systemPrompt }));
    source = createLLMEventSource({
      scenario: opts.scenario,
      contract: opts.contract,
      callFn,
      maxEvents: opts.maxEvents,
    });
  }

  const abortController = new AbortController();
  let pumpPromise: Promise<void> | null = null;

  const handle: EnvHandle = {
    bus,
    scenario: opts.scenario,
    runId,
    async start(): Promise<void> {
      if (pumpPromise) return; // 已启动
      pumpPromise = (async () => {
        try {
          for await (const e of source.stream(opts.scenario, abortController.signal)) {
            // L2 校验通过才 publish
            const valid = validateSemantics(e, { artifact: { family: contract.artifact_family, nodes: [] } as Artifact, contract });
            // 注:start 时无 artifact,L2 的 subject/locator 校验会失败 —— 改为只校验 constraint_id
            // 实际 L2 在 consume 时用真实 artifact 重做。这里宽松放行(只防 constraint_id 不存在)。
            if (e.kind === 'constraint_update' && !valid.ok) continue;
            bus.publish(e);
          }
        } catch (err) {
          // source 抛错(文件缺失等)—— start 不应 crash workflow,log 即可
          console.error('[env] source stream error:', err);
        }
      })();
    },
    async stop(): Promise<void> {
      abortController.abort();
      if (pumpPromise) await pumpPromise.catch(() => {});
      // record 模式:把 bus 里的事件写到 JSONL + stats
      if (opts.mode === 'record' && opts.fixturePath) {
        const events = bus.snapshot();
        const jsonl = events.map(e => JSON.stringify(e)).join('\n');
        writeFileSync(opts.fixturePath, jsonl + (jsonl ? '\n' : ''));
        // stats 路径 = fixturePath 同名 .stats.json
        const statsPath = opts.fixturePath.replace(/\.jsonl$/, '.stats.json');
        const stats = (source as EventSource & { getStats?: () => unknown }).getStats?.() ?? { yielded: events.length };
        writeFileSync(statsPath, JSON.stringify(stats, null, 2) + '\n');
      }
    },
    consume(artifact: Artifact): { artifact: Artifact; appliedEventIds: string[] } {
      const events = bus.drain();
      const result = consumeEvents(artifact, events, contract);
      return result;
    },
  };

  return handle;
}
