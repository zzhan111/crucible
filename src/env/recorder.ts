/**
 * Crucible Live Env — record 模式编排。
 * spec ref: 2026-06-30-crucible-live-env-design.md §4.1 (Record Mode)
 *
 * 跑 LLMEventSource,把 yield 的事件写 JSONL,stats 写 stats.json。
 * 产物供 replay 模式回放 + CI 闸门检查(stats.l1Failures === 0)。
 */
import { writeFileSync } from 'node:fs';
import { createLLMEventSource, type LLMStats } from './event-source/llm.js';
import type { LiveEnvEvent } from './types.js';
import type { Contract } from '../contract/schema.js';

export interface RecordOpts {
  scenario: string;
  contract: Contract;
  callFn: (prompt: string, opts: { temperature: number; seed: number; systemPrompt: string }) => Promise<Record<string, unknown> | null>;
  jsonlPath: string;
  statsPath: string;
  maxEvents?: number;
}

export async function recordScenario(opts: RecordOpts): Promise<LLMStats> {
  const source = createLLMEventSource({
    scenario: opts.scenario,
    contract: opts.contract,
    callFn: opts.callFn,
    maxEvents: opts.maxEvents,
  });

  const events: LiveEnvEvent[] = [];
  for await (const e of source.stream(opts.scenario, new AbortController().signal)) {
    events.push(e);
  }

  // 写 JSONL(每行一个事件)
  const jsonl = events.map(e => JSON.stringify(e)).join('\n');
  writeFileSync(opts.jsonlPath, jsonl + (jsonl ? '\n' : ''));

  // 写 stats
  const stats = source.getStats();
  writeFileSync(opts.statsPath, JSON.stringify(stats, null, 2) + '\n');

  return stats;
}
