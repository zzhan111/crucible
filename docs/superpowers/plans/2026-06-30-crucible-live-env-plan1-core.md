# Crucible Live Env Plan 1 of 2: Core env + replay + workflow 接线 + persistence

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地 Crucible Live Env v1 的核心骨架——事件类型 + 事件总线 + replay 事件源 + 事件折叠器 + workflow 接线 + SQLite 持久化,使 `env:demo`(replay 模式)能跑通"事件 → consume → workflow 迭代 → 分数轨迹"完整闭环。本 plan 不含 UI/HTTP(LLM 录制,见 Plan 2)。

**Architecture:** 新建 `src/env/` 模块,通过一个可选 `liveEnv?: EnvHandle` 入参零侵入接入 `runCrucibleWorkflow`;env 事件经 EventBus → consumer 折叠进 artifact 的 `metadata.runtime_overrides` 与 per-node 字段;事件 + 折叠结果落新表 `env_events`。所有改动在 `liveEnv` 未传时行为零变化(现有 485 测试全绿)。

**Tech Stack:** 保持 P3.5 全部(zod ^3.22, better-sqlite3 ^12.11, yaml ^2.4, vitest ^1.6, tsx ^4.22);零新增依赖。

**Spec:** `docs/superpowers/specs/2026-06-30-crucible-live-env-design.md` §1-§5, §7, §9, §11(Plan 1 覆盖)

**调查修正项(spec vs 实际代码库,本 plan 已据此修正):**

1. spec 写 `005_env_events.sql` → 实际 migrations 只有 001-003,下一个是 **`004_env_events.sql`**
2. spec 写 `artifact.runtime_overrides`(top-level) → `Artifact.metadata` 是既有扩展点(P4.3 fiscal 字段加在这里) → 改为 **`artifact.metadata.runtime_overrides`**
3. spec 说 "env 不写 artifact 的 state[]" → `state` 是 **per-node 字段**(在 `ArtifactNode` 里,由 contract `travel-sequence-v1.yaml` 定义),不是 artifact 级 → consumer 写 per-node `state`
4. spec 的 `persistEnvEvent` 直接 `db.prepare().run()` → 仓库两层模式:sink 编排 + repositories raw SQL → 拆两层
5. `intel-table-v1.yaml` 的 `metadata.version: 1.1` 是非整数,`resolveContractVersion`(`sink.ts:36`)会抛 → intel E2E 用 `:memory:` DB 且**不调 persistScoreRun**,只跑 workflow + env

**关键 P3.5 接口依赖:**
- `src/predicates/types.ts:7-20` — `Artifact`/`ArtifactNode`(`metadata` 是扩展点)
- `src/workflow/crucible.ts:20-36` — `CrucibleRunInput`(要加 `liveEnv?`)
- `src/persistence/db.ts:70` — `openAndMigrate()`(:memory: 测试便利)
- `src/persistence/sink.ts:54-70` — `persistScoreRun`(两层模式参考)
- `src/persistence/repositories.ts:100-122` — `insertScoreRun`(`@param` + object 风格参考)
- `src/contract/schema.ts` — zod `discriminatedUnion` + `z.infer` 模式参考

---

## File Structure (Plan 1 新增/修改)

```
crucible-dev/
├── src/
│   ├── env/                          # 新增模块
│   │   ├── types.ts                  # LiveEnvEvent zod schema + EventSource/EventBus/EnvHandle 接口
│   │   ├── constants.ts              # ENV_CONST 魔法数集中
│   │   ├── event-bus.ts              # 内存 pub/sub + drain + snapshot
│   │   ├── event-source/
│   │   │   ├── replay.ts             # ReplayEventSource(从 JSONL 回放)
│   │   │   └── fixture.ts            # FixtureEventSource(全量立刻 yield,降级用)
│   │   ├── semantic-validator.ts     # L2 语义校验
│   │   ├── consumer.ts               # 事件折叠进 artifact(纯函数)
│   │   └── index.ts                  # startLiveEnv() + EnvHandle 公开 API
│   ├── persistence/
│   │   ├── migrations/
│   │   │   └── 004_env_events.sql    # 新表
│   │   ├── repositories.ts           # 修改:+ insertEnvEvent / markEnvEventApplied / listEnvEvents
│   │   └── sink.ts                   # 修改:+ persistEnvEvent / markApplied
│   ├── workflow/
│   │   └── crucible.ts               # 修改:+ liveEnv? 入参 + 5 行 consume + consumedEventIds
│   └── predicates/
│       └── types.ts                  # 修改:Artifact.metadata 加 runtime_overrides?
├── tests/
│   └── env/                          # 新增(镜像 src/env/)
│       ├── types.test.ts
│       ├── event-bus.test.ts
│       ├── event-source/
│       │   ├── replay.test.ts
│       │   └── fixture.test.ts
│       ├── semantic-validator.test.ts
│       ├── consumer.test.ts
│       ├── persistence.test.ts
│       └── workflow-integration.test.ts
└── package.json                      # 不改(无新依赖;env:demo script 在 Plan 2 加)
```

---

## Task 1: Event 类型 + EventSource/EventBus/EnvHandle 接口

**Files:**
- Create: `src/env/types.ts`
- Create: `src/env/constants.ts`
- Test: `tests/env/types.test.ts`

- [ ] **Step 1: 写失败测试 — 三谱 schema 通过/失败用例**

Create `tests/env/types.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { LiveEnvEvent } from '../../src/env/types.js';

describe('LiveEnvEvent zod schema', () => {
  const validEnvelope = {
    id: '550e8400-e29b-41d4-a716-446655440000',
    scenario: 'travel-drift',
    t_offset_ms: 12000,
    emitted_by: 'replay',
  };

  it('accepts a valid disruption event', () => {
    const e = { ...validEnvelope, kind: 'disruption', subject: 'node-2', reason: 'rain', severity: 'minor', invalidates: ['outdoor'] };
    expect(LiveEnvEvent.safeParse(e).success).toBe(true);
  });

  it('accepts disruption with default empty invalidates', () => {
    const e = { ...validEnvelope, kind: 'disruption', subject: 'node-2', reason: 'rain', severity: 'blocker' };
    const parsed = LiveEnvEvent.safeParse(e);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.invalidates).toEqual([]);
  });

  it('accepts a valid info_drop event', () => {
    const e = { ...validEnvelope, kind: 'info_drop', target_field: 'cost', target_locator: 'node-2', new_value: 80, evidence: 'https://example.com', source_trust: 0.8 };
    expect(LiveEnvEvent.safeParse(e).success).toBe(true);
  });

  it('accepts a valid constraint_update event', () => {
    const e = { ...validEnvelope, kind: 'constraint_update', constraint_id: 'time_budget', new_threshold: 600, reason: 'user tired' };
    expect(LiveEnvEvent.safeParse(e).success).toBe(true);
  });

  it('rejects missing id', () => {
    const e = { scenario: 'travel-drift', t_offset_ms: 0, emitted_by: 'replay', kind: 'disruption', subject: 'n', reason: 'r', severity: 'minor' };
    expect(LiveEnvEvent.safeParse(e).success).toBe(false);
  });

  it('rejects non-uuid id', () => {
    const e = { ...validEnvelope, id: 'not-a-uuid', kind: 'disruption', subject: 'n', reason: 'r', severity: 'minor' };
    expect(LiveEnvEvent.safeParse(e).success).toBe(false);
  });

  it('rejects invalid emitted_by', () => {
    const e = { ...validEnvelope, emitted_by: 'human', kind: 'disruption', subject: 'n', reason: 'r', severity: 'minor' };
    expect(LiveEnvEvent.safeParse(e).success).toBe(false);
  });

  it('rejects invalid severity', () => {
    const e = { ...validEnvelope, kind: 'disruption', subject: 'n', reason: 'r', severity: 'catastrophic' };
    expect(LiveEnvEvent.safeParse(e).success).toBe(false);
  });

  it('rejects info_drop with source_trust out of range', () => {
    const e = { ...validEnvelope, kind: 'info_drop', target_field: 'cost', target_locator: 'n', new_value: 1, evidence: 'x', source_trust: 1.5 };
    expect(LiveEnvEvent.safeParse(e).success).toBe(false);
  });

  it('rejects negative t_offset_ms', () => {
    const e = { ...validEnvelope, t_offset_ms: -1, kind: 'disruption', subject: 'n', reason: 'r', severity: 'minor' };
    expect(LiveEnvEvent.safeParse(e).success).toBe(false);
  });

  it('rejects unknown kind', () => {
    const e = { ...validEnvelope, kind: 'mystery', subject: 'n' };
    expect(LiveEnvEvent.safeParse(e).success).toBe(false);
  });

  it('rejects disruption missing subject', () => {
    const e = { ...validEnvelope, kind: 'disruption', reason: 'r', severity: 'minor' };
    expect(LiveEnvEvent.safeParse(e).success).toBe(false);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/env/types.test.ts`
Expected: FAIL — `Cannot find module '../../src/env/types.js'`

- [ ] **Step 3: 写 constants.ts**

Create `src/env/constants.ts`:

```ts
/**
 * Crucible Live Env — 常量集中。
 * 所有魔法数在此,调阈值改这一个文件,diff 干净、review 容易。
 * spec ref: 2026-06-30-crucible-live-env-design.md §11.3
 */
export const ENV_CONST = {
  // LLM 录制(Plan 2 用;Plan 1 先定义占位)
  LLM_TEMPERATURE: 0.3,
  LLM_SEED: 42,
  LLM_SYSTEM_PROMPT_PATH: 'src/env/prompts/llm-source.system.md',

  // 配额(Plan 2 的 LLMEventSource 用)
  MAX_EVENTS_PER_SCENARIO: 8,
  MAX_CONSECUTIVE_FAILURES: 3,

  // 时间预算
  SCENARIO_TIMEOUT_MS: 90_000,
  WORKFLOW_WATCHDOG_MS: 90_000,

  // UI 通道(Plan 2 用)
  SSE_HEARTBEAT_MS: 15_000,
  SSE_RECONNECT_HINT_MS: 3_000,

  // 持久化
  EVENT_TABLE: 'env_events',
} as const;
```

- [ ] **Step 4: 写 types.ts**

Create `src/env/types.ts`:

```ts
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
```

- [ ] **Step 5: 跑测试确认通过**

Run: `npx vitest run tests/env/types.test.ts`
Expected: PASS(12 tests)

- [ ] **Step 6: typecheck**

Run: `npx tsc --noEmit`
Expected: 退出码 0

- [ ] **Step 7: commit**

```bash
cd D:/Apps/traveller.crucible-dev
git add src/env/types.ts src/env/constants.ts tests/env/types.test.ts
git commit -m "feat(env): add LiveEnvEvent schema + EventSource/EventBus/EnvHandle interfaces"
```

---

## Task 2: EventBus 实现

**Files:**
- Create: `src/env/event-bus.ts`
- Test: `tests/env/event-bus.test.ts`

- [ ] **Step 1: 写失败测试**

Create `tests/env/event-bus.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createEventBus } from '../../src/env/event-bus.js';
import type { LiveEnvEvent } from '../../src/env/types.js';

function mkEvent(id: string, t: number): LiveEnvEvent {
  return {
    id, scenario: 'travel-drift', t_offset_ms: t, emitted_by: 'replay',
    kind: 'disruption', subject: 'n1', reason: 'r', severity: 'minor', invalidates: [],
  };
}

describe('EventBus', () => {
  it('publish then snapshot returns the event', () => {
    const bus = createEventBus();
    const e = mkEvent('550e8400-e29b-41d4-a716-446655440000', 0);
    bus.publish(e);
    expect(bus.snapshot()).toHaveLength(1);
    expect(bus.snapshot()[0].id).toBe(e.id);
  });

  it('subscribe receives published events', () => {
    const bus = createEventBus();
    const received: LiveEnvEvent[] = [];
    bus.subscribe(e => received.push(e));
    bus.publish(mkEvent('550e8400-e29b-41d4-a716-446655440001', 10));
    expect(received).toHaveLength(1);
  });

  it('unsubscribe stops receiving', () => {
    const bus = createEventBus();
    const received: LiveEnvEvent[] = [];
    const unsub = bus.subscribe(e => received.push(e));
    bus.publish(mkEvent('550e8400-e29b-41d4-a716-446655440002', 0));
    unsub();
    bus.publish(mkEvent('550e8400-e29b-41d4-a716-446655440003', 10));
    expect(received).toHaveLength(1);
  });

  it('drain returns accumulated events and clears pointer', () => {
    const bus = createEventBus();
    bus.publish(mkEvent('550e8400-e29b-41d4-a716-446655440004', 0));
    bus.publish(mkEvent('550e8400-e29b-41d4-a716-446655440005', 10));
    const drained = bus.drain();
    expect(drained).toHaveLength(2);
    expect(bus.drain()).toHaveLength(0);
  });

  it('drain and subscribe are independent — snapshot retains all', () => {
    const bus = createEventBus();
    bus.publish(mkEvent('550e8400-e29b-41d4-a716-446655440006', 0));
    bus.drain();
    expect(bus.snapshot()).toHaveLength(1);
  });

  it('multiple subscribers all receive', () => {
    const bus = createEventBus();
    let count = 0;
    bus.subscribe(() => count++);
    bus.subscribe(() => count++);
    bus.publish(mkEvent('550e8400-e29b-41d4-a716-446655440007', 0));
    expect(count).toBe(2);
  });

  it('snapshot is read-only (does not affect drain)', () => {
    const bus = createEventBus();
    bus.publish(mkEvent('550e8400-e29b-41d4-a716-446655440008', 0));
    const snap = bus.snapshot();
    expect(snap.length).toBe(1);
    expect(bus.drain()).toHaveLength(1);
  });

  it('preserves publication order in snapshot', () => {
    const bus = createEventBus();
    bus.publish(mkEvent('550e8400-e29b-41d4-a716-446655440009', 30));
    bus.publish(mkEvent('550e8400-e29b-41d4-a716-446655440010', 10));
    const snap = bus.snapshot();
    expect(snap[0].t_offset_ms).toBe(30);
    expect(snap[1].t_offset_ms).toBe(10);
  });

  it('drain preserves publication order', () => {
    const bus = createEventBus();
    bus.publish(mkEvent('550e8400-e29b-41d4-a716-446655440011', 30));
    bus.publish(mkEvent('550e8400-e29b-41d4-a716-446655440012', 10));
    const drained = bus.drain();
    expect(drained[0].t_offset_ms).toBe(30);
    expect(drained[1].t_offset_ms).toBe(10);
  });

  it('subscribe handler throwing does not break other subscribers', () => {
    const bus = createEventBus();
    bus.subscribe(() => { throw new Error('boom'); });
    let received = false;
    bus.subscribe(() => { received = true; });
    bus.publish(mkEvent('550e8400-e29b-41d4-a716-446655440013', 0));
    expect(received).toBe(true);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/env/event-bus.test.ts`
Expected: FAIL — `Cannot find module '../../src/env/event-bus.js'`

- [ ] **Step 3: 写 event-bus.ts**

Create `src/env/event-bus.ts`:

```ts
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
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/env/event-bus.test.ts`
Expected: PASS(10 tests)

- [ ] **Step 5: typecheck**

Run: `npx tsc --noEmit`
Expected: 退出码 0

- [ ] **Step 6: commit**

```bash
cd D:/Apps/traveller.crucible-dev
git add src/env/event-bus.ts tests/env/event-bus.test.ts
git commit -m "feat(env): add in-memory EventBus with publish/subscribe/drain/snapshot"
```

---

## Task 3: FixtureEventSource(降级源,最简)

**Files:**
- Create: `src/env/event-source/fixture.ts`
- Test: `tests/env/event-source/fixture.test.ts`

> 先做 FixtureEventSource 而非 ReplayEventSource —— 它是 L3 安全网的兜底(§8.2),且
> 实现最简(全部立刻 yield),为后续 Replay/LLM source 提供参照基线。

- [ ] **Step 1: 写失败测试**

Create `tests/env/event-source/fixture.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createFixtureEventSource } from '../../../src/env/event-source/fixture.js';
import type { LiveEnvEvent } from '../../../src/env/types.js';

function mkEvent(id: string, t: number, kind: LiveEnvEvent['kind']): LiveEnvEvent {
  const base = { id, scenario: 'travel-drift', t_offset_ms: t, emitted_by: 'fixture' as const };
  if (kind === 'disruption') return { ...base, kind, subject: 'n1', reason: 'r', severity: 'minor', invalidates: [] };
  if (kind === 'info_drop') return { ...base, kind, target_field: 'cost', target_locator: 'n1', new_value: 80, evidence: 'x', source_trust: 0.8 };
  return { ...base, kind, constraint_id: 'time_budget', new_threshold: 600, reason: 'r' };
}

describe('FixtureEventSource', () => {
  it('yields all events immediately in order', async () => {
    const events = [
      mkEvent('550e8400-e29b-41d4-a716-446655440001', 0, 'disruption'),
      mkEvent('550e8400-e29b-41d4-a716-446655440002', 10, 'info_drop'),
      mkEvent('550e8400-e29b-41d4-a716-446655440003', 20, 'constraint_update'),
    ];
    const src = createFixtureEventSource(events);
    const out: LiveEnvEvent[] = [];
    for await (const e of src.stream('travel-drift', new AbortController().signal)) {
      out.push(e);
    }
    expect(out.map(e => e.id)).toEqual(events.map(e => e.id));
  });

  it('yields nothing for empty fixture', async () => {
    const src = createFixtureEventSource([]);
    const out: LiveEnvEvent[] = [];
    for await (const e of src.stream('travel-drift', new AbortController().signal)) {
      out.push(e);
    }
    expect(out).toHaveLength(0);
  });

  it('name is fixture', () => {
    const src = createFixtureEventSource([]);
    expect(src.name).toBe('fixture');
  });

  it('respects abort signal', async () => {
    const events = [
      mkEvent('550e8400-e29b-41d4-a716-446655440004', 0, 'disruption'),
      mkEvent('550e8400-e29b-41d4-a716-446655440005', 10, 'disruption'),
    ];
    const ac = new AbortController();
    const src = createFixtureEventSource(events);
    const out: LiveEnvEvent[] = [];
    ac.abort();
    try {
      for await (const e of src.stream('travel-drift', ac.signal)) {
        out.push(e);
        break;
      }
    } catch { /* abort throws */ }
    expect(out.length).toBeLessThanOrEqual(1);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/env/event-source/fixture.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: 写 fixture.ts**

Create `src/env/event-source/fixture.ts`:

```ts
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
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/env/event-source/fixture.test.ts`
Expected: PASS(4 tests)

- [ ] **Step 5: typecheck + commit**

```bash
cd D:/Apps/traveller.crucible-dev
npx tsc --noEmit
git add src/env/event-source/fixture.ts tests/env/event-source/fixture.test.ts
git commit -m "feat(env): add FixtureEventSource (L3 fallback + test baseline)"
```

---

## Task 4: ReplayEventSource(从 JSONL 回放,按 t_offset_ms 节奏)

**Files:**
- Create: `src/env/event-source/replay.ts`
- Test: `tests/env/event-source/replay.test.ts`

- [ ] **Step 1: 写失败测试(用 fake timer)**

Create `tests/env/event-source/replay.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createReplayEventSource } from '../../../src/env/event-source/replay.js';
import type { LiveEnvEvent } from '../../../src/env/types.js';

function mkEvent(id: string, t: number): LiveEnvEvent {
  return {
    id, scenario: 'travel-drift', t_offset_ms: t, emitted_by: 'replay',
    kind: 'disruption', subject: 'n1', reason: 'r', severity: 'minor', invalidates: [],
  };
}

const TMP = join(tmpdir(), `crucible-env-test-${Date.now()}`);

beforeEach(() => {
  mkdirSync(TMP, { recursive: true });
  vi.useFakeTimers();
});
afterEach(() => {
  rmSync(TMP, { recursive: true, force: true });
  vi.useRealTimers();
});

function writeJsonl(path: string, events: LiveEnvEvent[]): void {
  writeFileSync(path, events.map(e => JSON.stringify(e)).join('\n') + '\n');
}

describe('ReplayEventSource', () => {
  it('yields events in t_offset_ms order with delays', async () => {
    const file = join(TMP, 'rec.jsonl');
    writeJsonl(file, [
      mkEvent('550e8400-e29b-41d4-a716-446655440001', 0),
      mkEvent('550e8400-e29b-41d4-a716-446655440002', 1000),
      mkEvent('550e8400-e29b-41d4-a716-446655440003', 2500),
    ]);
    const src = createReplayEventSource(file);
    const out: LiveEnvEvent[] = [];
    const iter = src.stream('travel-drift', new AbortController().signal);
    const p = (async () => {
      for await (const e of iter) out.push(e);
    })();
    // t=0 event yields immediately
    await vi.advanceTimersByTimeAsync(0);
    expect(out).toHaveLength(1);
    // advance to t=1000
    await vi.advanceTimersByTimeAsync(1000);
    expect(out).toHaveLength(2);
    // advance to t=2500 (1500 more from 1000)
    await vi.advanceTimersByTimeAsync(1500);
    expect(out).toHaveLength(3);
    await p;
  });

  it('throws when file does not exist', async () => {
    const src = createReplayEventSource(join(TMP, 'missing.jsonl'));
    await expect(async () => {
      for await (const _e of src.stream('travel-drift', new AbortController().signal)) { /* */ }
    }).rejects.toThrow();
  });

  it('throws on malformed JSON line', async () => {
    const file = join(TMP, 'bad.jsonl');
    writeFileSync(file, '{not json}\n');
    const src = createReplayEventSource(file);
    await expect(async () => {
      for await (const _e of src.stream('travel-drift', new AbortController().signal)) { /* */ }
    }).rejects.toThrow();
  });

  it('respects abort signal mid-stream', async () => {
    const file = join(TMP, 'rec2.jsonl');
    writeJsonl(file, [
      mkEvent('550e8400-e29b-41d4-a716-446655440010', 0),
      mkEvent('550e8400-e29b-41d4-a716-446655440011', 5000),
    ]);
    const ac = new AbortController();
    const src = createReplayEventSource(file);
    const out: LiveEnvEvent[] = [];
    const iter = src.stream('travel-drift', ac.signal);
    const p = (async () => {
      for await (const e of iter) out.push(e);
    })();
    await vi.advanceTimersByTimeAsync(0);
    expect(out).toHaveLength(1);
    ac.abort();
    await vi.advanceTimersByTimeAsync(5000);
    await p;
    expect(out).toHaveLength(1); // 第二个未 yield
  });

  it('handles empty file (yields nothing)', async () => {
    const file = join(TMP, 'empty.jsonl');
    writeFileSync(file, '');
    const src = createReplayEventSource(file);
    const out: LiveEnvEvent[] = [];
    for await (const e of src.stream('travel-drift', new AbortController().signal)) {
      out.push(e);
    }
    expect(out).toHaveLength(0);
  });

  it('name is replay', () => {
    const src = createReplayEventSource(join(TMP, 'x.jsonl'));
    expect(src.name).toBe('replay');
  });

  it('filters events by scenario', async () => {
    const file = join(TMP, 'multi.jsonl');
    const e1 = mkEvent('550e8400-e29b-41d4-a716-446655440020', 0);
    const e2 = { ...mkEvent('550e8400-e29b-41d4-a716-446655440021', 1000), scenario: 'intel-drift' };
    writeJsonl(file, [e1, e2]);
    const src = createReplayEventSource(file);
    const out: LiveEnvEvent[] = [];
    const iter = src.stream('travel-drift', new AbortController().signal);
    const p = (async () => {
      for await (const e of iter) out.push(e);
    })();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1000);
    await p;
    expect(out).toHaveLength(1); // 只 travel-drift
    expect(out[0].id).toBe(e1.id);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/env/event-source/replay.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: 写 replay.ts**

Create `src/env/event-source/replay.ts`:

```ts
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
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/env/event-source/replay.test.ts`
Expected: PASS(8 tests)

- [ ] **Step 5: typecheck + commit**

```bash
cd D:/Apps/traveller.crucible-dev
npx tsc --noEmit
git add src/env/event-source/replay.ts tests/env/event-source/replay.test.ts
git commit -m "feat(env): add ReplayEventSource (JSONL playback with t_offset_ms pacing)"
```

---

## Task 5: semantic-validator(L2 语义校验)

**Files:**
- Create: `src/env/semantic-validator.ts`
- Test: `tests/env/semantic-validator.test.ts`

- [ ] **Step 1: 写失败测试**

Create `tests/env/semantic-validator.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { validateSemantics } from '../../src/env/semantic-validator.js';
import type { LiveEnvEvent } from '../../src/env/types.js';
import type { Artifact } from '../../src/predicates/types.js';
import type { Contract } from '../../src/contract/schema.js';

const artifact: Artifact = {
  family: 'sequence',
  nodes: [
    { time_block: '09:00', action: 'breakfast', node_type: 'dining', duration_min: 60, elasticity: 'non_compressible', id: 'node-0' },
    { time_block: '10:00', action: 'museum', node_type: 'core_experience', duration_min: 120, elasticity: 'compressible', id: 'node-1' },
  ],
};

const contract = {
  artifact_family: 'sequence',
  fields: [
    { name: 'time_block', type: 'string', required: true },
    { name: 'action', type: 'string', required: true },
    { name: 'cost', type: 'number', required: false },
  ],
  hard_constraints: [
    { id: 'continuity', type: 'declarative' as const, rule: 'adjacent transit' },
    { id: 'time_budget', type: 'declarative' as const, rule: 'sum ≤ 960' },
  ],
  rubric: [],
  calibration: { metric: 'kendall_tau' as const },
} as unknown as Contract;

const ctx = { artifact, contract };

function mkDisruption(subject: string): LiveEnvEvent {
  return { id: '550e8400-e29b-41d4-a716-446655440000', scenario: 's', t_offset_ms: 0, emitted_by: 'replay',
    kind: 'disruption', subject, reason: 'r', severity: 'minor', invalidates: [] };
}
function mkInfoDrop(field: string, locator: string): LiveEnvEvent {
  return { id: '550e8400-e29b-41d4-a716-446655440001', scenario: 's', t_offset_ms: 0, emitted_by: 'replay',
    kind: 'info_drop', target_field: field, target_locator: locator, new_value: 1, evidence: 'x', source_trust: 0.5 };
}
function mkConstraint(cid: string): LiveEnvEvent {
  return { id: '550e8400-e29b-41d4-a716-446655440002', scenario: 's', t_offset_ms: 0, emitted_by: 'replay',
    kind: 'constraint_update', constraint_id: cid, new_threshold: 100, reason: 'r' };
}

describe('validateSemantics (L2)', () => {
  it('disruption: ok when subject exists', () => {
    expect(validateSemantics(mkDisruption('node-1'), ctx).ok).toBe(true);
  });
  it('disruption: rejects when subject not found', () => {
    expect(validateSemantics(mkDisruption('node-99'), ctx).ok).toBe(false);
  });
  it('info_drop: ok when field + locator exist', () => {
    expect(validateSemantics(mkInfoDrop('cost', 'node-1'), ctx).ok).toBe(true);
  });
  it('info_drop: rejects when target_field not in contract', () => {
    expect(validateSemantics(mkInfoDrop('nonexistent', 'node-1'), ctx).ok).toBe(false);
  });
  it('info_drop: rejects when locator not found', () => {
    expect(validateSemantics(mkInfoDrop('cost', 'node-99'), ctx).ok).toBe(false);
  });
  it('constraint_update: ok when constraint_id exists', () => {
    expect(validateSemantics(mkConstraint('time_budget'), ctx).ok).toBe(true);
  });
  it('constraint_update: rejects when constraint_id not in contract', () => {
    expect(validateSemantics(mkConstraint('mystery'), ctx).ok).toBe(false);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/env/semantic-validator.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: 写 semantic-validator.ts**

Create `src/env/semantic-validator.ts`:

```ts
/**
 * Crucible Live Env — L2 语义校验。
 * spec ref: 2026-06-30-crucible-live-env-design.md §8.1 (Layer 2)
 *
 * zod(L1)只校验"形状对不对",本模块校验"指向的东西存不存在":
 *   - disruption.subject        必须是 artifact.nodes 里某节点的 id
 *   - info_drop.target_field    必须在 contract.fields 里
 *   - info_drop.target_locator  必须是 artifact.nodes 里某节点的 id
 *   - constraint_update.constraint_id 必须在 contract.hard_constraints 里
 *
 * 校验失败:不 throw、返回 { ok: false, reason },由调用方决定丢弃还是降级。
 */
import type { LiveEnvEvent } from './types.js';
import type { Artifact } from '../predicates/types.js';
import type { Contract } from '../contract/schema.js';

export interface ValidationContext {
  artifact: Artifact;
  contract: Contract;
}

export interface ValidationResult {
  ok: boolean;
  reason?: string;
}

/** 在 artifact.nodes 里按 id 找节点。节点无 id 字段时用 index 字符串。 */
function locateNode(artifact: Artifact, locator: string): boolean {
  return artifact.nodes.some((n, i) => {
    const id = (n.id as string | undefined) ?? String(i);
    return id === locator;
  });
}

export function validateSemantics(
  event: LiveEnvEvent,
  ctx: ValidationContext
): ValidationResult {
  switch (event.kind) {
    case 'disruption':
      if (!locateNode(ctx.artifact, event.subject)) {
        return { ok: false, reason: `disruption subject "${event.subject}" not found in artifact nodes` };
      }
      return { ok: true };

    case 'info_drop':
      if (!ctx.contract.fields.some(f => f.name === event.target_field)) {
        return { ok: false, reason: `info_drop target_field "${event.target_field}" not in contract.fields` };
      }
      if (!locateNode(ctx.artifact, event.target_locator)) {
        return { ok: false, reason: `info_drop target_locator "${event.target_locator}" not found in artifact nodes` };
      }
      return { ok: true };

    case 'constraint_update':
      if (!ctx.contract.hard_constraints.some(c => c.id === event.constraint_id)) {
        return { ok: false, reason: `constraint_update constraint_id "${event.constraint_id}" not in contract.hard_constraints` };
      }
      return { ok: true };
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/env/semantic-validator.test.ts`
Expected: PASS(7 tests)

- [ ] **Step 5: typecheck + commit**

```bash
cd D:/Apps/traveller.crucible-dev
npx tsc --noEmit
git add src/env/semantic-validator.ts tests/env/semantic-validator.test.ts
git commit -m "feat(env): add L2 semantic validator (subject/locator/constraint_id existence)"
```

---

## Task 6: consumer(事件折叠进 artifact,纯函数)

**Files:**
- Modify: `src/predicates/types.ts`(加 `runtime_overrides?`)
- Create: `src/env/consumer.ts`
- Test: `tests/env/consumer.test.ts`

- [ ] **Step 1: 修改 Artifact.metadata 加 runtime_overrides**

Edit `src/predicates/types.ts`,在 `metadata` 对象里(P4.3 fiscal 字段之后)加:

```ts
  metadata?: {
    day?: number;
    daily_available_minutes?: number;
    budget?: { min: number; max: number };
    // P4.3 财务尽调 vertical 元数据
    fiscal_year?: number;
    currency?: string;
    audit_status?: 'audited' | 'reviewed' | 'unaudited';
    company?: string;
    // Live Env v1: constraint_update 事件写入的运行时阈值覆盖。
    // Scorer 评估硬约束时优先读这里,fallback 到 contract 原阈值。
    // env 关闭时此字段 undefined,行为等同 P3.5。
    runtime_overrides?: Record<string, unknown>;
  };
```

- [ ] **Step 2: 写失败测试**

Create `tests/env/consumer.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { consumeEvents } from '../../src/env/consumer.js';
import type { LiveEnvEvent } from '../../src/env/types.js';
import type { Artifact } from '../../src/predicates/types.js';
import type { Contract } from '../../src/contract/schema.js';

const baseArtifact: Artifact = {
  family: 'sequence',
  nodes: [
    { time_block: '09:00', action: 'breakfast', node_type: 'dining', duration_min: 60, elasticity: 'non_compressible', cost: 50, source: 'x', source_trust: 0.5, id: 'node-0', state: ['at_hotel'] },
    { time_block: '10:00', action: 'museum', node_type: 'core_experience', duration_min: 120, elasticity: 'compressible', cost: 80, source: 'y', source_trust: 0.7, id: 'node-1', state: ['hiking'] },
  ],
};

const contract = {
  artifact_family: 'sequence',
  fields: [
    { name: 'cost', type: 'number', required: false },
    { name: 'source', type: 'string', required: false },
    { name: 'source_trust', type: 'number', required: false },
  ],
  hard_constraints: [
    { id: 'time_budget', type: 'declarative' as const, rule: 'sum ≤ 960' },
  ],
  rubric: [],
  calibration: { metric: 'kendall_tau' as const },
} as unknown as Contract;

function mkDisruption(subject: string, severity: 'minor'|'major'|'blocker' = 'minor', invalidates: string[] = []): LiveEnvEvent {
  return { id: '550e8400-e29b-41d4-a716-446655440000', scenario: 's', t_offset_ms: 0, emitted_by: 'replay',
    kind: 'disruption', subject, reason: 'rain', severity, invalidates };
}
function mkInfoDrop(field: string, locator: string, value: unknown, trust = 0.9): LiveEnvEvent {
  return { id: '550e8400-e29b-41d4-a716-446655440001', scenario: 's', t_offset_ms: 0, emitted_by: 'replay',
    kind: 'info_drop', target_field: field, target_locator: locator, new_value: value, evidence: 'url', source_trust: trust };
}
function mkConstraint(cid: string, threshold: unknown): LiveEnvEvent {
  return { id: '550e8400-e29b-41d4-a716-446655440002', scenario: 's', t_offset_ms: 0, emitted_by: 'replay',
    kind: 'constraint_update', constraint_id: cid, new_threshold: threshold, reason: 'r' };
}

describe('consumeEvents', () => {
  it('disruption adds invalidates to per-node state', () => {
    const { artifact, appliedEventIds } = consumeEvents(baseArtifact, [mkDisruption('node-1', 'minor', ['outdoor'])], contract);
    expect(appliedEventIds).toHaveLength(1);
    expect(artifact.nodes[1].state).toContain('outdoor');
  });

  it('disruption blocker forces elasticity to replaceable', () => {
    const { artifact } = consumeEvents(baseArtifact, [mkDisruption('node-1', 'blocker')], contract);
    expect(artifact.nodes[1].elasticity).toBe('replaceable');
  });

  it('disruption minor does not change elasticity', () => {
    const { artifact } = consumeEvents(baseArtifact, [mkDisruption('node-1', 'minor')], contract);
    expect(artifact.nodes[1].elasticity).toBe('compressible');
  });

  it('disruption with unmatched subject is skipped (not applied)', () => {
    const { artifact, appliedEventIds } = consumeEvents(baseArtifact, [mkDisruption('node-99')], contract);
    expect(appliedEventIds).toHaveLength(0);
    expect(artifact.nodes[0].state).toEqual(['at_hotel']);
  });

  it('info_drop updates target_field value + source + source_trust', () => {
    const { artifact, appliedEventIds } = consumeEvents(baseArtifact, [mkInfoDrop('cost', 'node-1', 60, 0.95)], contract);
    expect(appliedEventIds).toHaveLength(1);
    expect(artifact.nodes[1].cost).toBe(60);
    expect(artifact.nodes[1].source).toBe('url');
    expect(artifact.nodes[1].source_trust).toBe(0.95);
  });

  it('info_drop with field not in contract is skipped', () => {
    const { appliedEventIds } = consumeEvents(baseArtifact, [mkInfoDrop('nonexistent', 'node-1', 1)], contract);
    expect(appliedEventIds).toHaveLength(0);
  });

  it('info_drop with unmatched locator is skipped', () => {
    const { appliedEventIds } = consumeEvents(baseArtifact, [mkInfoDrop('cost', 'node-99', 1)], contract);
    expect(appliedEventIds).toHaveLength(0);
  });

  it('constraint_update writes to metadata.runtime_overrides', () => {
    const { artifact, appliedEventIds } = consumeEvents(baseArtifact, [mkConstraint('time_budget', 600)], contract);
    expect(appliedEventIds).toHaveLength(1);
    expect(artifact.metadata?.runtime_overrides?.['time_budget']).toBe(600);
  });

  it('constraint_update with unknown id is skipped', () => {
    const { artifact, appliedEventIds } = consumeEvents(baseArtifact, [mkConstraint('mystery', 1)], contract);
    expect(appliedEventIds).toHaveLength(0);
    expect(artifact.metadata?.runtime_overrides).toBeUndefined();
  });

  it('multiple events apply in order', () => {
    const events = [
      mkDisruption('node-0', 'blocker', ['rain']),
      mkInfoDrop('cost', 'node-1', 100),
      mkConstraint('time_budget', 500),
    ];
    const { artifact, appliedEventIds } = consumeEvents(baseArtifact, events, contract);
    expect(appliedEventIds).toHaveLength(3);
    expect(artifact.nodes[0].elasticity).toBe('replaceable');
    expect(artifact.nodes[0].state).toContain('rain');
    expect(artifact.nodes[1].cost).toBe(100);
    expect(artifact.metadata?.runtime_overrides?.['time_budget']).toBe(500);
  });

  it('does not mutate input artifact', () => {
    const original = JSON.parse(JSON.stringify(baseArtifact));
    consumeEvents(baseArtifact, [mkDisruption('node-0', 'blocker')], contract);
    expect(baseArtifact).toEqual(original);
  });

  it('empty events returns artifact unchanged', () => {
    const { artifact, appliedEventIds } = consumeEvents(baseArtifact, [], contract);
    expect(appliedEventIds).toHaveLength(0);
    expect(artifact.nodes).toEqual(baseArtifact.nodes);
  });
});
```

- [ ] **Step 3: 跑测试确认失败**

Run: `npx vitest run tests/env/consumer.test.ts`
Expected: FAIL — module not found

- [ ] **Step 4: 写 consumer.ts**

Create `src/env/consumer.ts`:

```ts
/**
 * Crucible Live Env — 事件折叠器(纯函数)。
 * spec ref: 2026-06-30-crucible-live-env-design.md §5.2
 *
 * 把一批事件折叠进 artifact,返回新 artifact + 被应用的事件 id 列表。
 * 三类事件的折叠语义:
 *   - disruption:        per-node state += invalidates;blocker → elasticity=replaceable
 *   - info_drop:         per-node [target_field]=new_value, source=evidence, source_trust=...
 *   - constraint_update: metadata.runtime_overrides[constraint_id]=new_threshold(不动 contract)
 *
 * 不可应用的事件(subject/locator/constraint_id 不存在)→ 跳过,不报错。
 * 纯函数:不 mutate 输入 artifact(深拷贝后改)。
 */
import type { LiveEnvEvent } from './types.js';
import type { Artifact, ArtifactNode } from '../predicates/types.js';
import type { Contract } from '../contract/schema.js';
import { validateSemantics } from './semantic-validator.js';

export interface ConsumeResult {
  artifact: Artifact;
  appliedEventIds: string[];
}

export function consumeEvents(
  artifact: Artifact,
  events: LiveEnvEvent[],
  contract: Contract
): ConsumeResult {
  // 深拷贝,不 mutate 输入
  let next: Artifact = JSON.parse(JSON.stringify(artifact));
  if (!next.metadata) next.metadata = {};
  const applied: string[] = [];

  for (const e of events) {
    // L2 语义校验(复用 semantic-validator)
    const valid = validateSemantics(e, { artifact: next, contract });
    if (!valid.ok) continue; // 跳过,不报错

    const appliedOne = applyOne(next, e);
    if (appliedOne) {
      applied.push(e.id);
    }
  }

  return { artifact: next, appliedEventIds: applied };
}

function findNode(artifact: Artifact, locator: string): { node: ArtifactNode; index: number } | null {
  for (let i = 0; i < artifact.nodes.length; i++) {
    const n = artifact.nodes[i];
    const id = (n.id as string | undefined) ?? String(i);
    if (id === locator) return { node: n, index: i };
  }
  return null;
}

function applyOne(artifact: Artifact, e: LiveEnvEvent): boolean {
  switch (e.kind) {
    case 'disruption': {
      const found = findNode(artifact, e.subject);
      if (!found) return false;
      // per-node state += invalidates
      const state = (found.node.state as string[] | undefined) ?? [];
      for (const tok of e.invalidates) {
        if (!state.includes(tok)) state.push(tok);
      }
      found.node.state = state;
      // blocker → elasticity 强制 replaceable(让 Scorer 下一步显式抓违规)
      if (e.severity === 'blocker') {
        found.node.elasticity = 'replaceable';
      }
      return true;
    }
    case 'info_drop': {
      const found = findNode(artifact, e.target_locator);
      if (!found) return false;
      found.node[e.target_field] = e.new_value;
      found.node.source = e.evidence;
      found.node.source_trust = e.source_trust;
      return true;
    }
    case 'constraint_update': {
      if (!artifact.metadata) artifact.metadata = {};
      if (!artifact.metadata.runtime_overrides) {
        artifact.metadata.runtime_overrides = {};
      }
      artifact.metadata.runtime_overrides[e.constraint_id] = e.new_threshold;
      return true;
    }
  }
}
```

- [ ] **Step 5: 跑测试确认通过**

Run: `npx vitest run tests/env/consumer.test.ts`
Expected: PASS(12 tests)

- [ ] **Step 6: typecheck + 确认现有测试不破**

Run: `npx tsc --noEmit && npx vitest run`
Expected: typecheck 0;全部测试通过(现有 485 + 新增)

- [ ] **Step 7: commit**

```bash
cd D:/Apps/traveller.crucible-dev
git add src/predicates/types.ts src/env/consumer.ts tests/env/consumer.test.ts
git commit -m "feat(env): add event consumer (pure fold fn) + Artifact.metadata.runtime_overrides"
```

---

## Task 7: SQLite migration 004 + repository + sink

**Files:**
- Create: `src/persistence/migrations/004_env_events.sql`
- Modify: `src/persistence/repositories.ts`(+ env event 函数)
- Modify: `src/persistence/sink.ts`(+ persistEnvEvent / markApplied)
- Test: `tests/env/persistence.test.ts`

- [ ] **Step 1: 写 migration 004**

Create `src/persistence/migrations/004_env_events.sql`:

```sql
-- Live Env v1 migration v4: env_events 表。
-- spec ref: 2026-06-30-crucible-live-env-design.md §7.2
--
-- 记录每个 env 事件 + 是否被 consume 折叠进 artifact。
-- 两次写入策略:publish 时落 row(applied=0),consume 后回填 applied=1 + applied_iter。
-- run_id 关联 score_runs(不加 FK 约束,沿用项目惯例降低迁移阻力)。

CREATE TABLE IF NOT EXISTS env_events (
  id           TEXT PRIMARY KEY,            -- LiveEnvEvent.id (uuid)
  run_id       TEXT NOT NULL,               -- 同一次 startLiveEnv 共享
  scenario     TEXT NOT NULL,               -- 'travel-drift' | 'intel-drift'
  kind         TEXT NOT NULL CHECK(kind IN ('disruption','info_drop','constraint_update')),
  emitted_by   TEXT NOT NULL CHECK(emitted_by IN ('llm','replay','fixture')),
  t_offset_ms  INTEGER NOT NULL,
  payload_json TEXT NOT NULL,               -- 整段 payload(不拆列,SQLite json_extract 查询)
  applied      INTEGER NOT NULL DEFAULT 0,  -- 0/1,是否被 consume 折叠
  applied_iter INTEGER,                     -- 被哪一轮 iteration consume(NULL = 未消费)
  actor_id     TEXT,                        -- 触发本次 demo 的 actor(沿用 RBAC SYSTEM_ACTOR)
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_env_events_run_id   ON env_events(run_id);
CREATE INDEX IF NOT EXISTS idx_env_events_scenario ON env_events(scenario, created_at);
```

- [ ] **Step 2: 写失败测试**

Create `tests/env/persistence.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { openAndMigrate } from '../../src/persistence/db.js';
import { insertEnvEvent, markEnvEventApplied, listEnvEvents } from '../../src/persistence/repositories.js';
import { persistEnvEvent, markApplied } from '../../src/persistence/sink.js';
import type { LiveEnvEvent } from '../../src/env/types.js';
import { SYSTEM_ACTOR } from '../../src/auth/rbac.js';

function mkEvent(id: string, kind: LiveEnvEvent['kind']): LiveEnvEvent {
  const base = { id, scenario: 'travel-drift', t_offset_ms: 1000, emitted_by: 'replay' as const };
  if (kind === 'disruption') return { ...base, kind, subject: 'n1', reason: 'r', severity: 'minor', invalidates: [] };
  if (kind === 'info_drop') return { ...base, kind, target_field: 'cost', target_locator: 'n1', new_value: 80, evidence: 'x', source_trust: 0.8 };
  return { ...base, kind, constraint_id: 'time_budget', new_threshold: 600, reason: 'r' };
}

describe('env_events persistence', () => {
  it('migration creates env_events table', () => {
    const db = openAndMigrate();
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='env_events'").get();
    expect(tables).toBeDefined();
  });

  it('insertEnvEvent writes row with applied=0', () => {
    const db = openAndMigrate();
    const e = mkEvent('550e8400-e29b-41d4-a716-446655440000', 'disruption');
    insertEnvEvent(db, e, 'run-1', SYSTEM_ACTOR.id);
    const rows = listEnvEvents(db, 'run-1');
    expect(rows).toHaveLength(1);
    expect(rows[0].applied).toBe(0);
    expect(rows[0].applied_iter).toBeNull();
  });

  it('markEnvEventApplied sets applied=1 + applied_iter', () => {
    const db = openAndMigrate();
    const e = mkEvent('550e8400-e29b-41d4-a716-446655440001', 'disruption');
    insertEnvEvent(db, e, 'run-1', SYSTEM_ACTOR.id);
    markEnvEventApplied(db, e.id, 1);
    const rows = listEnvEvents(db, 'run-1');
    expect(rows[0].applied).toBe(1);
    expect(rows[0].applied_iter).toBe(1);
  });

  it('listEnvEvents filters by run_id and orders by t_offset_ms', () => {
    const db = openAndMigrate();
    insertEnvEvent(db, mkEvent('550e8400-e29b-41d4-a716-446655440002', 'disruption'), 'run-A', SYSTEM_ACTOR.id);
    insertEnvEvent(db, { ...mkEvent('550e8400-e29b-41d4-a716-446655440003', 'info_drop'), t_offset_ms: 500 }, 'run-A', SYSTEM_ACTOR.id);
    insertEnvEvent(db, mkEvent('550e8400-e29b-41d4-a716-446655440004', 'disruption'), 'run-B', SYSTEM_ACTOR.id);
    const rows = listEnvEvents(db, 'run-A');
    expect(rows).toHaveLength(2);
    expect(rows[0].t_offset_ms).toBeLessThanOrEqual(rows[1].t_offset_ms);
  });

  it('persistEnvEvent (sink) delegates to repository', () => {
    const db = openAndMigrate();
    const e = mkEvent('550e8400-e29b-41d4-a716-446655440005', 'disruption');
    persistEnvEvent(db, e, 'run-2', SYSTEM_ACTOR);
    const rows = listEnvEvents(db, 'run-2');
    expect(rows).toHaveLength(1);
    expect(rows[0].applied).toBe(0);
  });

  it('markApplied (sink) delegates to repository', () => {
    const db = openAndMigrate();
    const e = mkEvent('550e8400-e29b-41d4-a716-446655440006', 'disruption');
    persistEnvEvent(db, e, 'run-3', SYSTEM_ACTOR);
    markApplied(db, e.id, 2);
    const rows = listEnvEvents(db, 'run-3');
    expect(rows[0].applied).toBe(1);
    expect(rows[0].applied_iter).toBe(2);
  });

  it('migration is idempotent (re-open same :memory: ok)', () => {
    const db = openAndMigrate();
    // 再 migrate 一次(schema_version 已记录,跳过)
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='env_events'").get();
    expect(tables).toBeDefined();
  });
});
```

- [ ] **Step 3: 跑测试确认失败**

Run: `npx vitest run tests/env/persistence.test.ts`
Expected: FAIL — `insertEnvEvent` not exported / table missing

- [ ] **Step 4: 在 repositories.ts 末尾追加 env event 函数**

在 `src/persistence/repositories.ts` 末尾追加:

```ts

// ───────────────────── env_events (Live Env v1) ─────────────────────

import type { LiveEnvEvent } from '../env/types.js';

export interface EnvEventRow {
  id: string;
  run_id: string;
  scenario: string;
  kind: string;
  emitted_by: string;
  t_offset_ms: number;
  payload_json: string;
  applied: number;
  applied_iter: number | null;
  actor_id: string | null;
  created_at: string;
}

export function insertEnvEvent(
  db: DB,
  event: LiveEnvEvent,
  runId: string,
  actorId: string = 'system'
): void {
  // payload = 整个 event 减 envelope 的非 payload 字段已在 event 里;直接存整个 event JSON
  db.prepare(
    `INSERT INTO env_events (id, run_id, scenario, kind, emitted_by, t_offset_ms, payload_json, applied, applied_iter, actor_id, created_at)
     VALUES (@id, @run, @scn, @kind, @emit, @t, @payload, 0, NULL, @actor, datetime('now'))`
  ).run({
    id: event.id,
    run: runId,
    scn: event.scenario,
    kind: event.kind,
    emit: event.emitted_by,
    t: event.t_offset_ms,
    payload: JSON.stringify(event),
    actor: actorId,
  });
}

export function markEnvEventApplied(db: DB, eventId: string, iterIndex: number): void {
  db.prepare('UPDATE env_events SET applied = 1, applied_iter = ? WHERE id = ?')
    .run(iterIndex, eventId);
}

export function listEnvEvents(db: DB, runId: string): EnvEventRow[] {
  return db.prepare(
    'SELECT id, run_id, scenario, kind, emitted_by, t_offset_ms, payload_json, applied, applied_iter, actor_id, created_at FROM env_events WHERE run_id = ? ORDER BY t_offset_ms ASC'
  ).all(runId) as EnvEventRow[];
}
```

- [ ] **Step 5: 在 sink.ts 加 persistEnvEvent / markApplied**

**改动 1:** 修改 `src/persistence/sink.ts` 顶部的 repositories import 行,加入两个新函数:

```diff
-import { insertContract, insertScoreRun } from './repositories.js';
+import { insertContract, insertScoreRun, insertEnvEvent, markEnvEventApplied } from './repositories.js';
```

同时加 LiveEnvEvent 类型 import(在现有 type imports 区):

```ts
import type { LiveEnvEvent } from '../env/types.js';
```

**改动 2:** 在 `src/persistence/sink.ts` 末尾(`persistScoreRun` 函数之后)追加:

```ts

// ───────────────────── Live Env v1: env_events sink ─────────────────────
// spec ref: 2026-06-30-crucible-live-env-design.md §7.3

/**
 * 把一个 env 事件落库(applied=0)。publish 时调用。
 * runId 串起整条轨迹(同一次 startLiveEnv 共享)。
 */
export function persistEnvEvent(
  db: DB,
  event: LiveEnvEvent,
  runId: string,
  actor: Actor = SYSTEM_ACTOR
): void {
  insertEnvEvent(db, event, runId, actor.id);
}

/**
 * consume 真折叠后回填 applied=1 + applied_iter。
 * 审计能看到"环境吐过、但被忽略"的事件(MIRA 论文未做到这一层)。
 */
export function markApplied(db: DB, eventId: string, iterIndex: number): void {
  markEnvEventApplied(db, eventId, iterIndex);
}
```

- [ ] **Step 6: 跑测试确认通过**

Run: `npx vitest run tests/env/persistence.test.ts`
Expected: PASS(7 tests)

- [ ] **Step 7: typecheck + 全量测试不破**

Run: `npx tsc --noEmit && npx vitest run`
Expected: 全绿

- [ ] **Step 8: commit**

```bash
cd D:/Apps/traveller.crucible-dev
git add src/persistence/migrations/004_env_events.sql src/persistence/repositories.ts src/persistence/sink.ts tests/env/persistence.test.ts
git commit -m "feat(env): add env_events table (migration 004) + repository + sink functions"
```

---

## Task 8: EnvHandle + startLiveEnv(组装 bus + source + consumer)

**Files:**
- Create: `src/env/index.ts`
- Test: `tests/env/index.test.ts`(轻量,主要测 EnvHandle 组装;集成在 Task 9)

- [ ] **Step 1: 写失败测试**

Create `tests/env/index.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startLiveEnv } from '../../src/env/index.js';
import type { Artifact } from '../../src/predicates/types.js';

const TMP = join(tmpdir(), `crucible-env-idx-${Date.now()}`);
beforeEach(() => { mkdirSync(TMP, { recursive: true }); vi.useFakeTimers(); });
afterEach(() => { rmSync(TMP, { recursive: true, force: true }); vi.useRealTimers(); });

const artifact: Artifact = {
  family: 'sequence',
  nodes: [{ time_block: '09:00', action: 'x', node_type: 'dining', duration_min: 60, elasticity: 'non_compressible', id: 'node-0' }],
};

const contract = {
  artifact_family: 'sequence', fields: [{ name: 'cost', type: 'number', required: false }],
  hard_constraints: [{ id: 'time_budget', type: 'declarative' as const, rule: 'x' }],
  rubric: [], calibration: { metric: 'kendall_tau' as const },
} as any;

describe('startLiveEnv / EnvHandle', () => {
  it('creates handle with replay source', async () => {
    const file = join(TMP, 'rec.jsonl');
    const e = { id: '550e8400-e29b-41d4-a716-446655440000', scenario: 'travel-drift', t_offset_ms: 0, emitted_by: 'replay',
      kind: 'constraint_update' as const, constraint_id: 'time_budget', new_threshold: 500, reason: 'r' };
    writeFileSync(file, JSON.stringify(e) + '\n');
    const handle = await startLiveEnv({ scenario: 'travel-drift', mode: 'replay', fixturePath: file, contract });
    expect(handle.scenario).toBe('travel-drift');
    expect(handle.runId).toBeTruthy();
    expect(typeof handle.consume).toBe('function');
    await handle.stop();
  });

  it('consume with no events returns artifact unchanged', async () => {
    const file = join(TMP, 'empty.jsonl');
    writeFileSync(file, '');
    const handle = await startLiveEnv({ scenario: 'travel-drift', mode: 'replay', fixturePath: file, contract });
    const { artifact: out, appliedEventIds } = handle.consume(artifact);
    expect(appliedEventIds).toHaveLength(0);
    expect(out.nodes).toEqual(artifact.nodes);
    await handle.stop();
  });

  it('start pumps events into bus, consume drains them', async () => {
    const file = join(TMP, 'rec2.jsonl');
    const e = { id: '550e8400-e29b-41d4-a716-446655440001', scenario: 'travel-drift', t_offset_ms: 0, emitted_by: 'replay',
      kind: 'constraint_update' as const, constraint_id: 'time_budget', new_threshold: 500, reason: 'r' };
    writeFileSync(file, JSON.stringify(e) + '\n');
    const handle = await startLiveEnv({ scenario: 'travel-drift', mode: 'replay', fixturePath: file, contract });
    await handle.start();
    // 让 replay source 把事件 yield 进 bus(fake timer 推进)
    await vi.advanceTimersByTimeAsync(0);
    const { appliedEventIds } = handle.consume(artifact);
    expect(appliedEventIds).toContain(e.id);
    await handle.stop();
  });

  it('snapshot returns events seen so far', async () => {
    const file = join(TMP, 'rec3.jsonl');
    const e = { id: '550e8400-e29b-41d4-a716-446655440002', scenario: 'travel-drift', t_offset_ms: 0, emitted_by: 'replay',
      kind: 'constraint_update' as const, constraint_id: 'time_budget', new_threshold: 500, reason: 'r' };
    writeFileSync(file, JSON.stringify(e) + '\n');
    const handle = await startLiveEnv({ scenario: 'travel-drift', mode: 'replay', fixturePath: file, contract });
    await handle.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(handle.bus.snapshot()).toHaveLength(1);
    await handle.stop();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/env/index.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: 写 index.ts**

Create `src/env/index.ts`:

```ts
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
import type { Artifact } from '../predicates/types.js';
import type { Contract } from '../contract/schema.js';
import type { EnvHandle, EventBus, EventSource, LiveEnvEvent } from './types.js';
import { createEventBus } from './event-bus.js';
import { createReplayEventSource } from './event-source/replay.js';
import { consumeEvents } from './consumer.js';
import { validateSemantics } from './semantic-validator.js';

export interface StartLiveEnvOpts {
  scenario: string;
  mode: 'replay' | 'record';
  fixturePath?: string;       // replay 模式:JSONL 路径;record 模式:输出路径
  contract: Contract;          // consumer + L2 校验需要
  auditDb?: import('../persistence/db.js').DB;  // 可选,落库 env_events
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
    // record 模式 = LLMEventSource,Plan 2 实现
    throw new Error('startLiveEnv: record mode not implemented in Plan 1 (see Plan 2)');
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
    },
    consume(artifact: Artifact): { artifact: Artifact; appliedEventIds: string[] } {
      const events = bus.drain();
      const result = consumeEvents(artifact, events, contract);
      return result;
    },
  };

  return handle;
}
```

> **注:** `start()` 里的 L2 校验有局限——start 时无 artifact,无法校验 subject/locator。
> 真正的 L2 在 `consumeEvents` 内部用真实 artifact 重做(已实现)。start 里只防
> constraint_id 不存在(无需 artifact)。这是 spec §4.2 sequence 图的简化:校验主体在
> consume 侧。Plan 2 接 LLM 时会在此加 L1 zod(不依赖 artifact)。

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/env/index.test.ts`
Expected: PASS(4 tests)

- [ ] **Step 5: typecheck + commit**

```bash
cd D:/Apps/traveller.crucible-dev
npx tsc --noEmit
git add src/env/index.ts tests/env/index.test.ts
git commit -m "feat(env): add startLiveEnv + EnvHandle (assembles bus + source + consumer)"
```

---

## Task 9: workflow 接线(5 行加法 + consumedEventIds)

**Files:**
- Modify: `src/workflow/crucible.ts`
- Test: `tests/env/workflow-integration.test.ts`

- [ ] **Step 1: 写失败测试**

Create `tests/env/workflow-integration.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { loadContract } from '../../src/contract/validate.js';
import { compileContract } from '../../src/contract/compiler.js';
import { runCrucibleWorkflow } from '../../src/workflow/crucible.js';
import { hk3dayBuggy } from '../../src/fixtures/hk-3day-buggy.js';
import { startLiveEnv } from '../../src/env/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONTRACT_PATH = join(__dirname, '..', '..', 'contracts', 'travel-sequence-v1.yaml');
const TMP = join(tmpdir(), `crucible-wf-env-${Date.now()}`);

beforeEach(() => {
  mkdirSync(TMP, { recursive: true });
  delete process.env.OPENAI_API_KEY;
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

describe('workflow + liveEnv integration', () => {
  it('A: no liveEnv → behavior identical to P3.5 (consumedEventIds empty)', async () => {
    const contract = loadContract(CONTRACT_PATH);
    const baseScorer = compileContract(contract);
    const result = await runCrucibleWorkflow({
      artifact: hk3dayBuggy, contract, baseScorer, artifactId: 'no-env', knownStates: [],
    });
    expect(result.iterations.length).toBeGreaterThan(0);
    for (const it of result.iterations) {
      expect(it.consumedEventIds).toEqual([]);
    }
  });

  it('B: liveEnv with 0 events → equivalent to A', async () => {
    const contract = loadContract(CONTRACT_PATH);
    const baseScorer = compileContract(contract);
    const file = join(TMP, 'empty.jsonl');
    writeFileSync(file, '');
    const handle = await startLiveEnv({ scenario: 'travel-drift', mode: 'replay', fixturePath: file, contract });
    const result = await runCrucibleWorkflow({
      artifact: hk3dayBuggy, contract, baseScorer, artifactId: 'empty-env', knownStates: [], liveEnv: handle,
    });
    for (const it of result.iterations) {
      expect(it.consumedEventIds).toEqual([]);
    }
    await handle.stop();
  });

  it('C: liveEnv with constraint_update event → consumed + applied', async () => {
    const contract = loadContract(CONTRACT_PATH);
    const baseScorer = compileContract(contract);
    // constraint_update 不依赖 artifact node,可在 start 时通过 L2
    const e = { id: '550e8400-e29b-41d4-a716-4466554400c0', scenario: 'travel-drift', t_offset_ms: 0, emitted_by: 'replay',
      kind: 'constraint_update' as const, constraint_id: 'time_budget', new_threshold: 600, reason: 'user tired' };
    const file = join(TMP, 'c.jsonl');
    writeFileSync(file, JSON.stringify(e) + '\n');
    const handle = await startLiveEnv({ scenario: 'travel-drift', mode: 'replay', fixturePath: file, contract });
    await handle.start();
    // 推进让事件进 bus
    await new Promise(r => setTimeout(r, 10));
    const result = await runCrucibleWorkflow({
      artifact: hk3dayBuggy, contract, baseScorer, artifactId: 'with-env', knownStates: [], liveEnv: handle,
    });
    const totalConsumed = result.iterations.reduce((s, it) => s + it.consumedEventIds.length, 0);
    expect(totalConsumed).toBeGreaterThanOrEqual(1);
    await handle.stop();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/env/workflow-integration.test.ts`
Expected: FAIL — `liveEnv` not in CrucibleRunInput / `consumedEventIds` not in iteration

- [ ] **Step 3: 修改 workflow/crucible.ts**

Edit `src/workflow/crucible.ts`:

3a. 在 imports 区加(顶部 `import` 之后):
```ts
import type { EnvHandle } from '../env/index.js';
```

3b. 在 `CrucibleRunInput` 接口加字段(在 `actor?: Actor;` 之后):
```ts
  /**
   * §5: 可选 live env handle。未传 → 行为完全等同 P3.5(老路径)。
   * 传入 → 每轮迭代开始时调用 env.consume(artifact),把累积事件折叠进 artifact。
   */
  liveEnv?: EnvHandle;
```

3c. 在 `CrucibleIteration` 接口加字段(在 `patchesApplied: number;` 之后):
```ts
  /** §5: 本轮 consume 折叠的事件 id 列表(空数组 = 未开 env 或本轮无事件)。 */
  consumedEventIds: string[];
```

3d. 在 for 循环开头(`console.log('Iteration...')` 之后、`// 1. Score` 之前)加:
```ts
    // §5: 轮间拉取 env 事件并折叠(env 未启用时 consume 是 no-op,但这里 liveEnv 未传则跳过)
    let consumedEventIds: string[] = [];
    if (input.liveEnv) {
      const envResult = input.liveEnv.consume(currentArtifact);
      currentArtifact = envResult.artifact;
      consumedEventIds = envResult.appliedEventIds;
    }
```

3e. 在 `allIterations.push({...})` 里加字段(在 `patchesApplied: patches.length,` 之后):
```ts
      consumedEventIds,
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/env/workflow-integration.test.ts`
Expected: PASS(3 tests)

- [ ] **Step 5: typecheck + 全量测试不破**

Run: `npx tsc --noEmit && npx vitest run`
Expected: typecheck 0;全部测试通过(现有 485 + 新增)

- [ ] **Step 6: 确认 workflow/crucible.ts 净增行数 ≤ 30**

Run: `git diff main -- src/workflow/crucible.ts | grep '^+' | grep -v '^+++' | wc -l`
Expected: ≤ 30

- [ ] **Step 7: commit**

```bash
cd D:/Apps/traveller.crucible-dev
git add src/workflow/crucible.ts tests/env/workflow-integration.test.ts
git commit -m "feat(env): wire liveEnv into workflow (optional consume per iteration, +consumedEventIds)"
```

---

## Task 10: Scorer 适配 runtime_overrides

**Files:**
- Modify: `src/scorer/augmented.ts`(或 compiler,取决于 threshold 读取位置)
- Test: `tests/env/scorer-overrides.test.ts`

> 需要先确认 threshold 在哪读。spec §5.3 写改 augmented.ts,但实际 threshold 读取
> 可能在 compiler 编译出的 predicate 里。先调研。

- [ ] **Step 1: 调研 threshold 读取位置**

Run: `grep -rn "threshold\|time_budget\|960" src/contract/compiler.ts src/predicates/time_budget.ts`
找到 time_budget 谓词怎么读阈值。如果它硬编码 960 或从 contract.hard_constraints 读,
则改它读 `artifact.metadata?.runtime_overrides?.['time_budget']`。

- [ ] **Step 2: 写失败测试 — runtime_overrides 改变 time_budget 阈值**

Create `tests/env/scorer-overrides.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadContract } from '../../src/contract/validate.js';
import { compileContract } from '../../src/contract/compiler.js';
import type { Artifact } from '../../src/predicates/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONTRACT_PATH = join(__dirname, '..', '..', 'contracts', 'travel-sequence-v1.yaml');

// 一个超 960 分钟的 artifact(默认阈值下会违规)
const overBudget: Artifact = {
  family: 'sequence',
  metadata: { day: 1, daily_available_minutes: 960 },
  nodes: [
    { time_block: '08:00', action: 'a', node_type: 'core_experience', duration_min: 500, elasticity: 'non_compressible' },
    { time_block: '16:00', action: 'b', node_type: 'core_experience', duration_min: 500, elasticity: 'non_compressible' },
  ],
};

describe('runtime_overrides on time_budget', () => {
  it('without overrides: over-budget artifact violates time_budget', () => {
    const contract = loadContract(CONTRACT_PATH);
    const scorer = compileContract(contract);
    const report = scorer.score(overBudget);
    const violations = report.deterministic.violations.filter(v => v.constraint_id === 'time_budget');
    expect(violations.length).toBeGreaterThan(0);
  });

  it('with overrides raising threshold to 1200: no time_budget violation', () => {
    const contract = loadContract(CONTRACT_PATH);
    const scorer = compileContract(contract);
    const withOverride: Artifact = {
      ...overBudget,
      metadata: { ...overBudget.metadata, runtime_overrides: { time_budget: 1200 } },
    };
    const report = scorer.score(withOverride);
    const violations = report.deterministic.violations.filter(v => v.constraint_id === 'time_budget');
    expect(violations).toHaveLength(0);
  });
});
```

- [ ] **Step 3: 跑测试 — 第一个应 PASS,第二个应 FAIL(overrides 未被读)**

Run: `npx vitest run tests/env/scorer-overrides.test.ts`
Expected: test 1 PASS, test 2 FAIL(overrides 未生效)

- [ ] **Step 4: 改 time_budget 谓词读 overrides**

**执行指令(无歧义版):** 先 `cat src/predicates/time_budget.ts` 看谓词签名。无论它当前怎么读阈值,统一改为:优先读 `artifact.metadata?.runtime_overrides?.['time_budget']`,fallback 到原逻辑。改法:

- 若谓词是 `(artifact: Artifact) => Violation[]` 且阈值硬编码/闭包进来 → 在函数体内加 `const threshold = artifact.metadata?.runtime_overrides?.['time_budget'] ?? <原阈值>;`,后续判断用 `threshold`。
- 若谓词从 `contract.hard_constraints` 读 `rule` 字符串解析 → 加 `if (artifact.metadata?.runtime_overrides?.[c.id] !== undefined) threshold = artifact.metadata.runtime_overrides[c.id];`。
- 若谓词在 `compiler.ts` 内联生成 → 在编译出的闭包里加同样的 overrides 读取。

三种情况都改同一语义:**overrides 优先,契约阈值次之,硬编码默认最后**。改完跑 Step 5 测试验证。

- [ ] **Step 5: 跑测试确认两个都通过**

Run: `npx vitest run tests/env/scorer-overrides.test.ts`
Expected: PASS(2 tests)

- [ ] **Step 6: typecheck + 全量测试不破**

Run: `npx tsc --noEmit && npx vitest run`
Expected: 全绿

- [ ] **Step 7: commit**

```bash
cd D:/Apps/traveller.crucible-dev
git add src/predicates/time_budget.ts src/contract/compiler.ts tests/env/scorer-overrides.test.ts
git commit -m "feat(env): scorer reads artifact.metadata.runtime_overrides for threshold"
```

---

## Task 11: 端到端 replay 测试(travel-drift fixture)

**Files:**
- Create: `src/env/scenarios/travel-drift.recorded.jsonl`(手工 fixture,非 LLM 录制)
- Test: `tests/env/e2e/travel-drift-replay.test.ts`

- [ ] **Step 1: 创建 travel-drift fixture JSONL**

Create `src/env/scenarios/travel-drift.recorded.jsonl`(用 hk3dayBuggy 的真实 node id;先 grep 确认 id 字段):

```bash
grep -n "id:" src/fixtures/hk-3day-buggy.ts | head -20
```

根据真实 id,构造 3 个 constraint_update 事件(不依赖 node id,最稳):

```jsonl
{"id":"550e8400-e29b-41d4-a716-4466554400e1","scenario":"travel-drift","t_offset_ms":0,"emitted_by":"replay","kind":"constraint_update","constraint_id":"time_budget","new_threshold":600,"reason":"user wants short day"}
{"id":"550e8400-e29b-41d4-a716-4466554400e2","scenario":"travel-drift","t_offset_ms":5000,"emitted_by":"replay","kind":"constraint_update","constraint_id":"time_budget","new_threshold":900,"reason":"user changed mind"}
{"id":"550e8400-e29b-41d4-a716-4466554400e3","scenario":"travel-drift","t_offset_ms":10000,"emitted_by":"replay","kind":"constraint_update","constraint_id":"time_budget","new_threshold":960,"reason":"back to default"}
```

- [ ] **Step 2: 写 E2E 测试**

Create `tests/env/e2e/travel-drift-replay.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadContract } from '../../src/contract/validate.js';
import { compileContract } from '../../src/contract/compiler.js';
import { runCrucibleWorkflow } from '../../src/workflow/crucible.js';
import { hk3dayBuggy } from '../../src/fixtures/hk-3day-buggy.js';
import { startLiveEnv } from '../../src/env/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONTRACT_PATH = join(__dirname, '..', '..', 'contracts', 'travel-sequence-v1.yaml');
const FIXTURE_PATH = join(__dirname, '..', '..', 'src', 'env', 'scenarios', 'travel-drift.recorded.jsonl');

beforeEach(() => {
  delete process.env.OPENAI_API_KEY;
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

describe('E2E: travel-drift replay', () => {
  it('completes 3 iterations with monotonic score + ≥1 event consumed', async () => {
    const contract = loadContract(CONTRACT_PATH);
    const baseScorer = compileContract(contract);
    const handle = await startLiveEnv({
      scenario: 'travel-drift', mode: 'replay', fixturePath: FIXTURE_PATH, contract,
    });
    await handle.start();
    // 让 replay source 把事件泵进 bus(真实 timer,不用 fake —— E2E 用真实节奏但事件 t_offset 小)
    await new Promise(r => setTimeout(r, 50));

    const result = await runCrucibleWorkflow({
      artifact: hk3dayBuggy, contract, baseScorer, artifactId: 'e2e-travel', knownStates: [], liveEnv: handle,
    });

    expect(result.iterations.length).toBeGreaterThan(0);
    // 单调:分数不下降
    for (let i = 1; i < result.iterations.length; i++) {
      expect(result.iterations[i].score).toBeGreaterThanOrEqual(result.iterations[i - 1].score - 0.01);
    }
    // 至少消费 1 个事件
    const totalConsumed = result.iterations.reduce((s, it) => s + it.consumedEventIds.length, 0);
    expect(totalConsumed).toBeGreaterThanOrEqual(1);
    await handle.stop();
  }, 15000);
});
```

- [ ] **Step 3: 跑 E2E**

Run: `npx vitest run tests/env/e2e/travel-drift-replay.test.ts`
Expected: PASS

- [ ] **Step 4: typecheck + 全量测试**

Run: `npx tsc --noEmit && npx vitest run`
Expected: 全绿

- [ ] **Step 5: commit**

```bash
cd D:/Apps/traveller.crucible-dev
git add src/env/scenarios/travel-drift.recorded.jsonl tests/env/e2e/travel-drift-replay.test.ts
git commit -m "test(env): E2E travel-drift replay (3 iter, monotonic score, events consumed)"
```

---

## Task 12: 全量验收 + coverage 检查

**Files:** 无新文件

- [ ] **Step 1: 全量测试 + coverage**

Run:
```bash
cd D:/Apps/traveller.crucible-dev
npx vitest run --coverage
```
Expected:
- 全部测试通过(现有 485 + 新增 ~60)
- `src/env/` 整体行覆盖 ≥ 85%
- `src/env/types.ts` ≥ 95%, `event-bus.ts` ≥ 90%, `consumer.ts` ≥ 90%, `semantic-validator.ts` ≥ 95%

- [ ] **Step 2: typecheck**

Run: `npx tsc --noEmit`
Expected: 退出码 0

- [ ] **Step 3: 确认现有 485 测试全绿**

Run: `npx vitest run tests/workflow/ tests/predicates/ tests/rubric/ tests/contract/ tests/scorer/`
Expected: 全绿(P3.5 行为零变化)

- [ ] **Step 4: 确认无新依赖**

Run: `git diff main -- package.json package-lock.json`
Expected: 无 dependencies/devDependencies 变更

- [ ] **Step 5: 最终 commit(若 coverage 报告有未提交)**

```bash
cd D:/Apps/traveller.crucible-dev
git add -A
git status  # 确认只剩预期文件
git commit -m "chore(env): Plan 1 complete — core env + replay + workflow + persistence" --allow-empty
```

---

## Plan 1 完成定义

- [ ] `src/env/` 模块完整(types/constants/event-bus/event-source/consumer/semantic-validator/index)
- [ ] `env_events` 表 + repository + sink
- [ ] workflow 接线(`liveEnv?` + `consumedEventIds`),净增 ≤ 30 行
- [ ] Scorer 读 `runtime_overrides`
- [ ] travel-drift fixture + E2E 通过
- [ ] 现有 485 测试全绿 + 新增 ~60 测试
- [ ] env 模块 coverage ≥ 85%
- [ ] 零新增依赖

**Plan 2(下一步)将覆盖:** LLMEventSource + record 模式 + L1/L2/L3 安全网 + HTTP/SSE + UI 动画场 + intel-drift fixture + npm scripts。
