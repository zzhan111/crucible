/**
 * Crucible Live Env — 事件类型 + 接口定义。
 * spec ref: 2026-06-30-crucible-live-env-design.md §3
 *
 * 三谱 Event schema(zod discriminatedUnion by kind):
 *   - disruption:        环境扰动(下雨/闭馆/下线),改 per-node state + elasticity
 *   - info_drop:         新数据到达(特价/新融资),改 per-node 字段值 + source
 *   - constraint_update: 运行时阈值变化(用户改步数预算),写 metadata.runtime_overrides
 *
 * 关键设计:kind 由各 payload 自己 z.literal 声明,EventEnvelope 不重复声明 kind ——
 * zod merge 时 envelope 的 enum 会被 payload 的 literal 覆盖,enum 那行属冗余(spec 自审修正 #3)。
 */
import { z } from 'zod';
import type { Artifact } from '../predicates/types.js';

// ── 信封(所有事件共享)────────────────────────────────────────
const EventEnvelope = z.object({
  id: z.string().uuid(),
  scenario: z.string(),
  t_offset_ms: z.number().int().min(0),
  emitted_by: z.enum(['llm', 'replay', 'fixture']),
  // kind 由各 payload 自己 z.literal 声明,此处不重复 —— 否则 zod merge 时
  // envelope 的 enum 会被 payload 的 literal 覆盖,enum 那行属冗余。
});

// ── 三谱 payload ──────────────────────────────────────────────
const DisruptionPayload = z.object({
  kind: z.literal('disruption'),
  subject: z.string(),                    // 受影响的节点 id(locator)
  reason: z.string(),                     // 自然语言原因(UI + Critic 读)
  severity: z.enum(['minor', 'major', 'blocker']),
  invalidates: z.array(z.string()).default([]),  // 失效的 state token 列表
});

const InfoDropPayload = z.object({
  kind: z.literal('info_drop'),
  target_field: z.string(),               // contract.fields 里的字段名
  target_locator: z.string(),             // 哪个节点(id)
  new_value: z.unknown(),                 // 新值,downstream 自行校验
  evidence: z.string(),                   // source URL / 引用
  source_trust: z.number().min(0).max(1), // 沿用 contract 现有维度
});

const ConstraintUpdatePayload = z.object({
  kind: z.literal('constraint_update'),
  constraint_id: z.string(),              // contract.hard_constraints[].id
  new_threshold: z.unknown(),             // 新阈值(数值/枚举)
  reason: z.string(),
});

// ── 三选一并集(discriminated by kind)─────────────────────────
export const LiveEnvEvent = z.discriminatedUnion('kind', [
  EventEnvelope.merge(DisruptionPayload),
  EventEnvelope.merge(InfoDropPayload),
  EventEnvelope.merge(ConstraintUpdatePayload),
]);
export type LiveEnvEvent = z.infer<typeof LiveEnvEvent>;

// ── EventSource 接口 ──────────────────────────────────────────
export interface EventSource {
  readonly name: 'llm' | 'replay' | 'fixture';
  /**
   * 启动事件流。返回 async iterator,Bus 在 hot path 上消费。
   * 实现方负责按 t_offset_ms 控制节奏。
   */
  stream(scenario: string, signal: AbortSignal): AsyncIterable<LiveEnvEvent>;
}

// ── EventBus 接口 ─────────────────────────────────────────────
export interface EventBus {
  publish(event: LiveEnvEvent): void;
  subscribe(handler: (e: LiveEnvEvent) => void): () => void;  // 返回 unsubscribe
  /** Workflow consumer 用:返回自上次 drain 以来累积的事件,然后清空未消费指针。 */
  drain(): LiveEnvEvent[];
  /** 已发布的全部事件(只读,供 UI 重连时回灌画布)。 */
  snapshot(): readonly LiveEnvEvent[];
}

// ── EnvHandle(对外公开 API)──────────────────────────────────
export interface EnvHandle {
  bus: EventBus;
  scenario: string;
  runId: string;
  start(): Promise<void>;
  stop(): Promise<void>;
  /** 把 drain 出来的事件折叠进 artifact。 */
  consume(artifact: Artifact): { artifact: Artifact; appliedEventIds: string[] };
}
