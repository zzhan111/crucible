# Crucible Live Env Plan 2 of 2: LLM 录制 + 安全网 + HTTP/SSE + UI 动画场 + 双幕

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Plan 1 的核心骨架上,叠加 LLM 录制(record 模式)+ 三层安全网(L1/L2/L3)+ HTTP/SSE server + 浏览器动画场 UI + intel-drift 第二幕 fixture + npm scripts,使 `env:demo`(路演现场 replay)与 `env:record`(开发期录制)两条路径都能跑通。

**Architecture:** LLMEventSource 复用 `@ai-sdk/openai` + `ai` SDK(非 OpenAI 原生 SDK),通过依赖注入 `callFn` 实现可测;HTTP server 用 `node:http` 手写 SSE(无 Express),导出纯 handler 供单测;UI 在 `demo-html.ts` 追加 §6 段 + `http.ts` 提供 live SSE 页面,两形态共用渲染逻辑;intel-drift fixture 用 string-index locator(因 intel-table fixture 无 `id` 字段)。

**Tech Stack:** 保持 Plan 1 全部;复用 `@ai-sdk/openai` ^2.0 + `ai` ^6.0(已在 dependencies);零新增依赖。

**Spec:** `docs/superpowers/specs/2026-06-30-crucible-live-env-design.md` §4(record 模式)、§6(UI)、§8(安全网)、§11.6-11.7(scripts + SSE types)

**Plan 1 依赖(已实现):**
- `src/env/types.ts` — EventSource 接口、LiveEnvEvent schema
- `src/env/event-source/fixture.ts` — createFixtureEventSource(L3 兜底)
- `src/env/event-source/replay.ts` — createReplayEventSource
- `src/env/index.ts` — startLiveEnv(record 分支当前 throw,本 plan 填充)
- `src/env/consumer.ts` + `semantic-validator.ts` — L2 校验
- `src/persistence/sink.ts` — persistEnvEvent / markApplied
- `src/workflow/crucible.ts` — liveEnv 接线已完成

**调查修正项(spec vs 实际代码库,本 plan 已据此修正):**

1. spec §8.2 说"response_format 直接传 OpenAI SDK" → 实际 LLM client 用 Vercel `ai` SDK 的 `generateText`,不直接调 OpenAI SDK → LLMEventSource 用 `generateText` + `experimental_json` 或解析文本返回的 JSON
2. spec §8.2 说 temperature=0.3 + seed=42 → 现有 `callLLM` 故意不设 temperature(reasoning model 不支持)→ LLMEventSource 自己传 temperature/seed(只对录制期负责,不影响 judge)
3. spec 说 intel-drift events 用 node id → intel-table fixture **无 `id` 字段**,consumer/validator 用 `n.id ?? String(index)` → intel-drift 的 `target_locator`/`subject` 必须用 string index `"0"`,`"1"`...
4. spec §11.6 的 `env:record` script 用 Unix `VAR=val` 前缀 → 与跨平台 .mjs wrapper 哲学冲突 → wrapper 内部读 argv 设 env,script 行不带前缀
5. spec 说 demo-html §6 是动画场 → 实际 demo-html 是**纯静态无 `<script>`**报告 → §6 static 形态用内嵌 JSONL + 内联 `<script>` 自播(首次引入 script 标签);live 形态在 `http.ts` 单独提供
6. spec §7.2 说 migration `005` → Plan 1 已用 `004` → 本 plan 无新 migration(表已在 Plan 1 建好)

---

## File Structure (Plan 2 新增/修改)

```
crucible-dev/
├── src/
│   ├── env/
│   │   ├── event-source/
│   │   │   └── llm.ts                 # 新增:LLMEventSource + L1/L3 安全网
│   │   ├── prompts/
│   │   │   └── llm-source.system.md   # 新增:录制期 system prompt(git 跟踪)
│   │   ├── scenarios/
│   │   │   ├── intel-drift.recorded.jsonl    # 新增:第二幕 fixture
│   │   │   ├── intel-drift.fallback.jsonl    # 新增:第二幕兜底
│   │   │   ├── travel-drift.fallback.jsonl   # 新增:第一幕兜底(Plan 1 未建)
│   │   │   ├── travel-drift.record-stats.json # 新增:录制 metrics(CI 闸门)
│   │   │   └── intel-drift.record-stats.json
│   │   ├── http.ts                    # 新增:SSE server + 静态 HTML 页面
│   │   ├── recorder.ts                # 新增:record 模式编排(写 JSONL + stats)
│   │   └── index.ts                   # 修改:填充 record 分支
│   ├── llm/
│   │   └── client.ts                  # 修改:+ callLLMJson(结构化输出变体)
│   └── demo-html.ts                   # 修改:+ §6 Live Env 静态段
├── scripts/
│   └── run-live-env.mjs              # 新增:跨平台启动器
└── tests/
    └── env/
        ├── event-source/
        │   └── llm.test.ts            # 新增:mock LLM + L1/L3 切换
        ├── http.test.ts               # 新增:SSE handler 纯函数测试
        ├── recorder.test.ts           # 新增:录制产物 + stats
        ├── scenarios/
        │   ├── intel-drift.fixture.test.ts   # 新增:第二幕契约校验
        │   ├── fallback-parity.test.ts       # 新增:两幕兜底各三类事件
        │   └── recorded-quality.test.ts      # 新增:CI 闸门(stats=0)
        └── e2e/
            ├── intel-drift-replay.test.ts    # 新增:E2E-2 第二幕
            └── record-mode.test.ts           # 新增:E2E-5 mock LLM 录制
```

---

## Task 1: callLLMJson — 结构化 JSON 输出变体

**Files:**
- Modify: `src/llm/client.ts`(+ `callLLMJson`)
- Test: `tests/llm/client-json.test.ts`

> LLMEventSource 需要 JSON 输出 + temperature/seed 控制,现有 `callLLM` 不支持。
> 加一个兄弟函数,复用 `createOpenAI` + `openai.chat(model)` 模式。

- [ ] **Step 1: 写失败测试**

Create `tests/llm/client-json.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { callLLMJson, hasApiKey } from '../../src/llm/client.js';

describe('callLLMJson', () => {
  let savedKey: string | undefined;
  beforeEach(() => { savedKey = process.env.OPENAI_API_KEY; });
  afterEach(() => {
    if (savedKey !== undefined) process.env.OPENAI_API_KEY = savedKey;
    else delete process.env.OPENAI_API_KEY;
  });

  it('returns null when no API key', async () => {
    delete process.env.OPENAI_API_KEY;
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await callLLMJson('prompt', { temperature: 0.3, seed: 42 });
    expect(result).toBeNull();
    warnSpy.mockRestore();
  });

  it('returns parsed object when LLM returns valid JSON', async () => {
    process.env.OPENAI_API_KEY = 'sk-test';
    // mock generateText 返回合法 JSON
    vi.doMock('ai', () => ({
      generateText: vi.fn().mockResolvedValue({ text: '{"kind":"disruption","subject":"n1"}' }),
    }));
    const { callLLMJson: mocked } = await import('../../src/llm/client.js');
    const result = await mocked('prompt', { temperature: 0.3, seed: 42 });
    expect(result).toEqual({ kind: 'disruption', subject: 'n1' });
    vi.doUnmock('ai');
  });

  it('returns null when LLM returns non-JSON text', async () => {
    process.env.OPENAI_API_KEY = 'sk-test';
    vi.doMock('ai', () => ({
      generateText: vi.fn().mockResolvedValue({ text: 'not json at all' }),
    }));
    const { callLLMJson: mocked } = await import('../../src/llm/client.js');
    const result = await mocked('prompt', { temperature: 0.3 });
    expect(result).toBeNull();
    vi.doUnmock('ai');
  });

  it('returns null on LLM error', async () => {
    process.env.OPENAI_API_KEY = 'sk-test';
    vi.doMock('ai', () => ({
      generateText: vi.fn().mockRejectedValue(new Error('network')),
    }));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { callLLMJson: mocked } = await import('../../src/llm/client.js');
    const result = await mocked('prompt', { temperature: 0.3 });
    expect(result).toBeNull();
    warnSpy.mockRestore();
    vi.doUnmock('ai');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/llm/client-json.test.ts`
Expected: FAIL — `callLLMJson` not exported

- [ ] **Step 3: 在 client.ts 加 callLLMJson**

在 `src/llm/client.ts` 末尾追加:

```ts

export interface LLMJsonOptions {
  temperature?: number;
  seed?: number;
  systemPrompt?: string;
}

/**
 * 结构化 JSON 输出变体。复用 createOpenAI 模式,但:
 * - 传 temperature/seed(录制期需要,不影响 judge 的 callLLM)
 * - 解析返回文本为 JSON,失败返回 null
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
    // 尝试解析 JSON(容错:可能返回带 markdown fence 的 JSON)
    const text = result.text.trim();
    const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    return JSON.parse(cleaned);
  } catch (err) {
    console.warn(`[LLM] callLLMJson failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/llm/client-json.test.ts`
Expected: PASS(4 tests)

- [ ] **Step 5: typecheck + 全量不破**

Run: `npx tsc --noEmit && npx vitest run`
Expected: 全绿

- [ ] **Step 6: commit**

```bash
cd D:/Apps/traveller.crucible-dev
git add src/llm/client.ts tests/llm/client-json.test.ts
git commit -m "feat(llm): add callLLMJson for structured JSON output with temperature/seed"
```

---

## Task 2: LLM system prompt 文件

**Files:**
- Create: `src/env/prompts/llm-source.system.md`

- [ ] **Step 1: 创建 system prompt**

Create `src/env/prompts/llm-source.system.md`:

```markdown
# Crucible Live Env — LLM EventSource System Prompt

你是一个环境模拟器,为 Crucible 多智能体系统生成"世界漂移事件"。

## 你的角色

你不是 agent,你是**agents 们要应对的世界**。你产出事件,事件会被 consume 进 artifact,
驱动 Scorer/Critic/Curator 做连续决策。

## 事件三谱(只产出这三类,不要别的)

1. **disruption** — 环境扰动(下雨/闭馆/下线/堵车)
2. **info_drop** — 新数据到达(特价/新融资/新报告)
3. **constraint_update** — 运行时阈值变化(用户改步数预算/时间窗口)

## 输出格式

每次产出**一个 JSON 对象**,严格遵守以下 schema 之一。不要输出多个、不要加解释文字。

### disruption
```json
{"kind":"disruption","subject":"<节点 id>","reason":"<自然语言>","severity":"minor|major|blocker","invalidates":["<state token>"]}
```

### info_drop
```json
{"kind":"info_drop","target_field":"<contract 字段名>","target_locator":"<节点 id>","new_value":"<值>","evidence":"<URL/引用>","source_trust":0.0}
```

### constraint_update
```json
{"kind":"constraint_update","constraint_id":"<contract 约束 id>","new_threshold":"<值>","reason":"<自然语言>"}
```

## 叙事纪律(对应 CAVEAT-001)

- **不要反复对同一节点触发 disruption** —— 单调重复无聊
- **不要让 info_drop 在同一字段来回抖动** —— 无方向的噪声
- **constraint_update 要对分数曲线有戏剧推动** —— 别调无关紧要的阈值
- 每个事件都应有**明确的叙事意图**:它要让 demo 观众看到"世界变了,agent 必须应对"

## 信封字段(由系统填充,你不要产出)

`id` / `scenario` / `t_offset_ms` / `emitted_by` —— 这些由 EventSource 包装,你只产出 payload。
```

- [ ] **Step 2: commit**

```bash
cd D:/Apps/traveller.crucible-dev
git add src/env/prompts/llm-source.system.md
git commit -m "feat(env): add LLM EventSource system prompt (narrative discipline per CAVEAT-001)"
```

---

## Task 3: LLMEventSource + L1/L3 安全网

**Files:**
- Create: `src/env/event-source/llm.ts`
- Test: `tests/env/event-source/llm.test.ts`

- [ ] **Step 1: 写失败测试(mock callFn)**

Create `tests/env/event-source/llm.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { createLLMEventSource } from '../../../src/env/event-source/llm.js';
import type { LiveEnvEvent } from '../../../src/env/types.js';

// mock callFn:返回合法事件 JSON
function mkValidEvent(id: string): Record<string, unknown> {
  return { kind: 'constraint_update', constraint_id: 'time_budget', new_threshold: 500, reason: 'test' };
}

describe('LLMEventSource', () => {
  it('name is llm', () => {
    const src = createLLMEventSource({
      scenario: 'travel-drift',
      contract: { hard_constraints: [{ id: 'time_budget' }] } as any,
      callFn: async () => mkValidEvent('1'),
    });
    expect(src.name).toBe('llm');
  });

  it('yields valid events from callFn', async () => {
    let count = 0;
    const src = createLLMEventSource({
      scenario: 'travel-drift',
      contract: { hard_constraints: [{ id: 'time_budget' }] } as any,
      callFn: async () => {
        count++;
        return count <= 2 ? mkValidEvent(String(count)) : null; // 第三次返回 null = 结束
      },
    });
    const out: LiveEnvEvent[] = [];
    for await (const e of src.stream('travel-drift', new AbortController().signal)) {
      out.push(e);
    }
    expect(out).toHaveLength(2);
    expect(out[0].emitted_by).toBe('llm');
  });

  it('L1: skips events that fail zod validation', async () => {
    let count = 0;
    const src = createLLMEventSource({
      scenario: 'travel-drift',
      contract: { hard_constraints: [{ id: 'time_budget' }] } as any,
      callFn: async () => {
        count++;
        if (count === 1) return { kind: 'disruption', reason: 'r' }; // 缺 subject/severity → zod fail
        return null;
      },
    });
    const out: LiveEnvEvent[] = [];
    for await (const e of src.stream('travel-drift', new AbortController().signal)) out.push(e);
    expect(out).toHaveLength(0);
  });

  it('L2: skips events with unknown constraint_id', async () => {
    let count = 0;
    const src = createLLMEventSource({
      scenario: 'travel-drift',
      contract: { hard_constraints: [{ id: 'time_budget' }] } as any,
      callFn: async () => {
        count++;
        if (count === 1) return { kind: 'constraint_update', constraint_id: 'mystery', new_threshold: 1, reason: 'r' };
        return null;
      },
    });
    const out: LiveEnvEvent[] = [];
    for await (const e of src.stream('travel-drift', new AbortController().signal)) out.push(e);
    expect(out).toHaveLength(0);
  });

  it('L3: switches to fixture fallback after MAX_CONSECUTIVE_FAILURES', async () => {
    let count = 0;
    const fallbackEvents: LiveEnvEvent[] = [{
      id: '550e8400-e29b-41d4-a716-4466554400fb', scenario: 'travel-drift', t_offset_ms: 0, emitted_by: 'fixture',
      kind: 'constraint_update', constraint_id: 'time_budget', new_threshold: 960, reason: 'fallback',
    }];
    const src = createLLMEventSource({
      scenario: 'travel-drift',
      contract: { hard_constraints: [{ id: 'time_budget' }] } as any,
      callFn: async () => { count++; return { kind: 'bad' }; }, // 永远返回非法
      fallbackEvents,
    });
    const out: LiveEnvEvent[] = [];
    for await (const e of src.stream('travel-drift', new AbortController().signal)) out.push(e);
    // 3 次失败后切 fallback,fallback 有 1 个事件
    expect(out).toHaveLength(1);
    expect(out[0].emitted_by).toBe('fixture');
  });

  it('L3: switches to fixture after MAX_EVENTS_PER_SCENARIO reached', async () => {
    let count = 0;
    const src = createLLMEventSource({
      scenario: 'travel-drift',
      contract: { hard_constraints: [{ id: 'time_budget' }] } as any,
      callFn: async () => {
        count++;
        return count <= 10 ? mkValidEvent(String(count)) : null; // 超过 8
      },
      fallbackEvents: [],
      maxEvents: 8, // 测试用小值
    });
    const out: LiveEnvEvent[] = [];
    for await (const e of src.stream('travel-drift', new AbortController().signal)) out.push(e);
    expect(out.length).toBeLessThanOrEqual(8);
  });

  it('respects abort signal', async () => {
    const ac = new AbortController();
    let callCount = 0;
    const src = createLLMEventSource({
      scenario: 'travel-drift',
      contract: { hard_constraints: [{ id: 'time_budget' }] } as any,
      callFn: async () => {
        callCount++;
        if (callCount === 1) { ac.abort(); }
        return mkValidEvent('1');
      },
    });
    const out: LiveEnvEvent[] = [];
    try {
      for await (const e of src.stream('travel-drift', ac.signal)) out.push(e);
    } catch { /* abort */ }
    expect(out.length).toBeLessThanOrEqual(1);
  });

  it('callFn returning null ends stream gracefully', async () => {
    const src = createLLMEventSource({
      scenario: 'travel-drift',
      contract: { hard_constraints: [{ id: 'time_budget' }] } as any,
      callFn: async () => null,
    });
    const out: LiveEnvEvent[] = [];
    for await (const e of src.stream('travel-drift', new AbortController().signal)) out.push(e);
    expect(out).toHaveLength(0);
  });

  it('records metrics (l1Failures, l2Failures, totalCalls)', async () => {
    let count = 0;
    const src = createLLMEventSource({
      scenario: 'travel-drift',
      contract: { hard_constraints: [{ id: 'time_budget' }] } as any,
      callFn: async () => {
        count++;
        if (count === 1) return { kind: 'bad' }; // L1 fail
        if (count === 2) return { kind: 'constraint_update', constraint_id: 'mystery', new_threshold: 1, reason: 'r' }; // L2 fail
        return null;
      },
    });
    for await (const _e of src.stream('travel-drift', new AbortController().signal)) { /* */ }
    const stats = src.getStats();
    expect(stats.l1Failures).toBe(1);
    expect(stats.l2Failures).toBe(1);
    expect(stats.totalCalls).toBe(2);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/env/event-source/llm.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: 写 llm.ts**

Create `src/env/event-source/llm.ts`:

```ts
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
      let yielded = 0;
      let consecutiveFailures = 0;

      while (!signal.aborted) {
        if (yielded >= maxEvents) {
          // L3 配额超限 → 切 fallback
          stats.fellBack = true;
          yield* fixtureFallback(scenario, signal, opts);
          return;
        }

        stats.totalCalls++;
        const payload = await opts.callFn(
          `Generate one drift event for scenario "${scenario}". Output one JSON object per the system prompt.`,
          { temperature: ENV_CONST.LLM_TEMPERATURE, seed: ENV_CONST.LLM_SEED, systemPrompt: getSystemPrompt() }
        );

        if (payload === null) {
          // callFn 返回 null(LLM 无 key / 出错 / 自然结束)→ 结束流
          return;
        }

        // L1: zod 校验
        const envelope = {
          id: randomUUID(),
          scenario,
          t_offset_ms: Date.now(), // 录制时用绝对时间戳,回放时由 replay 按 t_offset 排序
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
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/env/event-source/llm.test.ts`
Expected: PASS(9 tests)

- [ ] **Step 5: typecheck + commit**

```bash
cd D:/Apps/traveller.crucible-dev
npx tsc --noEmit
git add src/env/event-source/llm.ts tests/env/event-source/llm.test.ts
git commit -m "feat(env): add LLMEventSource with L1/L2/L3 safety net + injectable callFn"
```

---

## Task 4: recorder — record 模式编排(写 JSONL + stats)

**Files:**
- Create: `src/env/recorder.ts`
- Test: `tests/env/recorder.test.ts`

- [ ] **Step 1: 写失败测试**

Create `tests/env/recorder.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { recordScenario } from '../../src/env/recorder.js';

const TMP = join(tmpdir(), `crucible-rec-${Date.now()}`);
beforeEach(() => mkdirSync(TMP, { recursive: true }));
afterEach(() => rmSync(TMP, { recursive: true, force: true }));

describe('recorder', () => {
  it('writes JSONL + stats files', async () => {
    const jsonlPath = join(TMP, 'out.jsonl');
    const statsPath = join(TMP, 'out.stats.json');
    const stats = await recordScenario({
      scenario: 'travel-drift',
      contract: { artifact_family: 'sequence', fields: [], hard_constraints: [{ id: 'time_budget', type: 'declarative' }], rubric: [], calibration: { metric: 'kendall_tau' } } as any,
      callFn: async () => ({ kind: 'constraint_update', constraint_id: 'time_budget', new_threshold: 500, reason: 'r' }),
      jsonlPath,
      statsPath,
      maxEvents: 2,
    });
    const jsonl = readFileSync(jsonlPath, 'utf8').trim().split('\n');
    expect(jsonl).toHaveLength(2);
    JSON.parse(jsonl[0]); // 不抛
    const statsFile = JSON.parse(readFileSync(statsPath, 'utf8'));
    expect(statsFile.totalCalls).toBe(2);
    expect(statsFile.l1Failures).toBe(0);
    expect(statsFile.l2Failures).toBe(0);
    expect(stats.yielded).toBe(2);
  });

  it('stats records L1 failures', async () => {
    const stats = await recordScenario({
      scenario: 'travel-drift',
      contract: { artifact_family: 'sequence', fields: [], hard_constraints: [{ id: 'time_budget', type: 'declarative' }], rubric: [], calibration: { metric: 'kendall_tau' } } as any,
      callFn: async () => ({ kind: 'bad' }), // L1 fail
      jsonlPath: join(TMP, 'bad.jsonl'),
      statsPath: join(TMP, 'bad.stats.json'),
      maxEvents: 5,
    });
    expect(stats.l1Failures).toBeGreaterThan(0);
    expect(stats.yielded).toBe(0);
  });

  it('empty output when callFn always returns null', async () => {
    const jsonlPath = join(TMP, 'empty.jsonl');
    await recordScenario({
      scenario: 'travel-drift',
      contract: { artifact_family: 'sequence', fields: [], hard_constraints: [{ id: 'time_budget', type: 'declarative' }], rubric: [], calibration: { metric: 'kendall_tau' } } as any,
      callFn: async () => null,
      jsonlPath,
      statsPath: join(TMP, 'empty.stats.json'),
    });
    const content = readFileSync(jsonlPath, 'utf8');
    expect(content.trim()).toBe('');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/env/recorder.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: 写 recorder.ts**

Create `src/env/recorder.ts`:

```ts
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
  callFn: LLMStats extends never ? never : (prompt: string, opts: { temperature: number; seed: number; systemPrompt: string }) => Promise<Record<string, unknown> | null>;
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
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/env/recorder.test.ts`
Expected: PASS(3 tests)

- [ ] **Step 5: typecheck + commit**

```bash
cd D:/Apps/traveller.crucible-dev
npx tsc --noEmit
git add src/env/recorder.ts tests/env/recorder.test.ts
git commit -m "feat(env): add recorder (writes JSONL + stats for record mode)"
```

---

## Task 5: 填充 startLiveEnv record 分支

**Files:**
- Modify: `src/env/index.ts`(record 分支当前 throw)
- Test: `tests/env/index-record.test.ts`

- [ ] **Step 1: 写失败测试**

Create `tests/env/index-record.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startLiveEnv } from '../../src/env/index.js';

const TMP = join(tmpdir(), `crucible-idx-rec-${Date.now()}`);
beforeEach(() => mkdirSync(TMP, { recursive: true }));
afterEach(() => rmSync(TMP, { recursive: true, force: true }));

const contract = {
  artifact_family: 'sequence', fields: [],
  hard_constraints: [{ id: 'time_budget', type: 'declarative' as const }],
  rubric: [], calibration: { metric: 'kendall_tau' as const },
} as any;

describe('startLiveEnv record mode', () => {
  it('does not throw "not implemented"', async () => {
    const handle = await startLiveEnv({
      scenario: 'travel-drift', mode: 'record',
      fixturePath: join(TMP, 'out.jsonl'), contract,
      callFn: async () => ({ kind: 'constraint_update', constraint_id: 'time_budget', new_threshold: 500, reason: 'r' }),
      maxEvents: 1,
    });
    expect(handle.scenario).toBe('travel-drift');
    await handle.start();
    await new Promise(r => setTimeout(r, 50));
    await handle.stop();
    const content = readFileSync(join(TMP, 'out.jsonl'), 'utf8');
    expect(content.trim().length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: 跑测试确认失败(throw "not implemented")**

Run: `npx vitest run tests/env/index-record.test.ts`
Expected: FAIL — "record mode not implemented in Plan 1"

- [ ] **Step 3: 修改 index.ts 填充 record 分支**

Edit `src/env/index.ts`:

3a. 加 imports(顶部):
```ts
import { createLLMEventSource } from './event-source/llm.js';
import { recordScenario } from './recorder.js';
import { callLLMJson } from '../llm/client.js';
```

3b. 扩展 `StartLiveEnvOpts` 接口加 record 模式字段:
```ts
export interface StartLiveEnvOpts {
  scenario: string;
  mode: 'replay' | 'record';
  fixturePath?: string;
  contract: Contract;
  auditDb?: import('../persistence/db.js').DB;
  /** record 模式:注入 callFn(测试用);默认用 callLLMJson */
  callFn?: (prompt: string, opts: { temperature: number; seed: number; systemPrompt: string }) => Promise<Record<string, unknown> | null>;
  /** record 模式:最大事件数(测试用) */
  maxEvents?: number;
}
```

3c. 替换 record 分支(原来 throw 的那段):
```ts
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
```

3d. 在 `stop()` 里加 record 模式产物写入(在 abort 之后)。

先在 index.ts 顶部加静态 import(与其他 import 一起):
```ts
import { writeFileSync } from 'node:fs';
```

然后 `stop()` 改为:
```ts
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
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/env/index-record.test.ts`
Expected: PASS

- [ ] **Step 5: typecheck + 全量不破**

Run: `npx tsc --noEmit && npx vitest run`
Expected: 全绿

- [ ] **Step 6: commit**

```bash
cd D:/Apps/traveller.crucible-dev
git add src/env/index.ts tests/env/index-record.test.ts
git commit -m "feat(env): implement record mode in startLiveEnv (LLMEventSource + JSONL/stats output)"
```

---

## Task 6: HTTP/SSE server(纯 handler + node:http transport)

**Files:**
- Create: `src/env/http.ts`
- Test: `tests/env/http.test.ts`

- [ ] **Step 1: 写失败测试(纯 handler,不启真实端口)**

Create `tests/env/http.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { formatSseMessage, handleSnapshotRequest } from '../../src/env/http.js';
import { createEventBus } from '../../src/env/event-bus.js';
import type { LiveEnvEvent } from '../../src/env/types.js';

function mkEvent(id: string): LiveEnvEvent {
  return { id, scenario: 'travel-drift', t_offset_ms: 0, emitted_by: 'replay',
    kind: 'constraint_update', constraint_id: 'time_budget', new_threshold: 500, reason: 'r' };
}

describe('http helpers', () => {
  it('formatSseMessage formats event type + data', () => {
    const msg = formatSseMessage('env-event', { id: 'x' });
    expect(msg).toBe('event: env-event\ndata: {"id":"x"}\n\n');
  });

  it('formatSseMessage handles heartbeat (empty data)', () => {
    const msg = formatSseMessage('heartbeat', '');
    expect(msg).toBe('event: heartbeat\ndata: \n\n');
  });

  it('handleSnapshotRequest returns events + iterations JSON', () => {
    const bus = createEventBus();
    bus.publish(mkEvent('550e8400-e29b-41d4-a716-446655440001'));
    const result = handleSnapshotRequest(bus, []);
    const parsed = JSON.parse(result);
    expect(parsed.events).toHaveLength(1);
    expect(parsed.iterations).toEqual([]);
  });

  it('handleSnapshotRequest includes iterations', () => {
    const bus = createEventBus();
    const result = handleSnapshotRequest(bus, [
      { index: 0, scoreBefore: 0.4, scoreAfter: 0.6, consumedEventIds: ['e1'] },
    ]);
    const parsed = JSON.parse(result);
    expect(parsed.iterations).toHaveLength(1);
    expect(parsed.iterations[0].scoreAfter).toBe(0.6);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/env/http.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: 写 http.ts**

Create `src/env/http.ts`:

```ts
/**
 * Crucible Live Env — HTTP/SSE server。
 * spec ref: 2026-06-30-crucible-live-env-design.md §6.2, §11.7
 *
 * 两个 endpoint:
 *   GET /env/snapshot?scenario=...  → 一次性 JSON {events, iterations}
 *   GET /env/stream?scenario=...    → SSE,6 种 message type
 *
 * 纯函数(formatSseMessage, handleSnapshotRequest)可单测;
 * startHttpServer() 用 node:http 启真实端口(路演用)。
 * 不引 Express/Socket.io(spec §6.2)。
 */
import http from 'node:http';
import { ENV_CONST } from './constants.js';
import type { EventBus, LiveEnvEvent } from './types.js';

export interface IterationInfo {
  index: number;
  scoreBefore: number;
  scoreAfter: number;
  consumedEventIds: string[];
}

/** 格式化一条 SSE message(spec §11.7 6 种 type) */
export function formatSseMessage(type: string, data: unknown): string {
  const payload = typeof data === 'string' ? data : JSON.stringify(data);
  return `event: ${type}\ndata: ${payload}\n\n`;
}

/** snapshot endpoint 的纯函数:返回 JSON 字符串 */
export function handleSnapshotRequest(bus: EventBus, iterations: IterationInfo[]): string {
  return JSON.stringify({
    events: bus.snapshot(),
    iterations,
  });
}

/** 启动 HTTP server(路演用,测试不调) */
export function startHttpServer(
  bus: EventBus,
  iterations: IterationInfo[],
  port: number = 5173
): http.Server {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://localhost:${port}`);

    if (url.pathname === '/env/snapshot') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(handleSnapshotRequest(bus, iterations));
      return;
    }

    if (url.pathname === '/env/stream') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
      });

      // 首帧 meta
      res.write(formatSseMessage('meta', { scenario: url.searchParams.get('scenario'), startedAt: new Date().toISOString() }));

      // 订阅 bus
      const unsub = bus.subscribe((e: LiveEnvEvent) => {
        res.write(formatSseMessage('env-event', e));
      });

      // 心跳
      const heartbeat = setInterval(() => {
        res.write(formatSseMessage('heartbeat', ''));
      }, ENV_CONST.SSE_HEARTBEAT_MS);

      // 清理
      req.on('close', () => {
        unsub();
        clearInterval(heartbeat);
      });
      return;
    }

    // 默认:返回 live HTML 页面
    if (url.pathname === '/' || url.pathname === '/env') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(liveHtmlPage());
      return;
    }

    res.writeHead(404);
    res.end('Not found');
  });

  server.listen(port);
  return server;
}

/** live 形态的 HTML 页面(SSE 订阅 + vanilla JS 渲染) */
function liveHtmlPage(): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>Crucible Live Env</title>
<style>
  body { font-family: system-ui, sans-serif; margin: 20px; background: #fafafa; }
  .card { background: white; border: 1px solid #ddd; border-radius: 8px; padding: 16px; margin: 12px 0; }
  .timeline { font-family: monospace; font-size: 13px; line-height: 1.6; }
  .event { padding: 4px 8px; margin: 2px 0; border-left: 3px solid #666; }
  .event.disruption { border-color: #e74c3c; }
  .event.info_drop { border-color: #3498db; }
  .event.constraint_update { border-color: #f39c12; }
  .score { font-size: 24px; font-weight: bold; color: #27ae60; }
  #status { color: #999; font-size: 12px; }
</style>
</head>
<body>
<h1>Crucible Live Env</h1>
<div id="status">connecting...</div>
<div class="card">
  <h2>Event Timeline</h2>
  <div id="timeline" class="timeline"></div>
</div>
<div class="card">
  <h2>Score</h2>
  <div id="score" class="score">—</div>
</div>
<script>
const timeline = document.getElementById('timeline');
const scoreEl = document.getElementById('score');
const statusEl = document.getElementById('status');

const params = new URLSearchParams(location.search);
const scenario = params.get('scenario') || 'travel-drift';
const es = new EventSource('/env/stream?scenario=' + scenario);

es.addEventListener('meta', (e) => { statusEl.textContent = 'live: ' + scenario; });
es.addEventListener('env-event', (e) => {
  const ev = JSON.parse(e.data);
  const div = document.createElement('div');
  div.className = 'event ' + ev.kind;
  const t = new Date(ev.t_offset_ms).toISOString().substr(14, 5);
  div.textContent = t + ' [' + ev.kind + '] ' + (ev.reason || ev.constraint_id || ev.subject || '');
  timeline.appendChild(div);
});
es.addEventListener('iteration', (e) => {
  const it = JSON.parse(e.data);
  scoreEl.textContent = it.scoreAfter.toFixed(2);
});
es.addEventListener('heartbeat', () => { statusEl.textContent = 'live: ' + scenario + ' (♥)'; });
es.addEventListener('done', (e) => { statusEl.textContent = 'done: ' + JSON.parse(e.data).reason; });
es.onerror = () => { statusEl.textContent = 'reconnecting...'; };
</script>
</body>
</html>`;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/env/http.test.ts`
Expected: PASS(4 tests)

- [ ] **Step 5: typecheck + commit**

```bash
cd D:/Apps/traveller.crucible-dev
npx tsc --noEmit
git add src/env/http.ts tests/env/http.test.ts
git commit -m "feat(env): add HTTP/SSE server (pure handlers + node:http transport + live HTML)"
```

---

## Task 7: intel-drift fixture + 兜底 fixtures

**Files:**
- Create: `src/env/scenarios/intel-drift.recorded.jsonl`
- Create: `src/env/scenarios/intel-drift.fallback.jsonl`
- Create: `src/env/scenarios/travel-drift.fallback.jsonl`
- Create: `src/env/scenarios/travel-drift.record-stats.json`
- Create: `src/env/scenarios/intel-drift.record-stats.json`
- Test: `tests/env/scenarios/intel-drift.fixture.test.ts`
- Test: `tests/env/scenarios/fallback-parity.test.ts`
- Test: `tests/env/scenarios/recorded-quality.test.ts`

> intel-table fixture 无 `id` 字段,locator 用 string index `"0"`,`"1"`...
> constraint_id 用 intel-table-v1.yaml 的 6 个:no_empty_source / pricing_format /
> no_duplicate_competitor / stale_pricing / source_trust_floor / unit_consistency

- [ ] **Step 1: 创建 intel-drift recorded fixture**

Create `src/env/scenarios/intel-drift.recorded.jsonl`:

```jsonl
{"id":"660e8400-e29b-41d4-a716-4466554400i1","scenario":"intel-drift","t_offset_ms":0,"emitted_by":"replay","kind":"info_drop","target_field":"pricing","target_locator":"1","new_value":"$25/mo (was $40)","evidence":"https://example.com/pricing-update","source_trust":0.85}
{"id":"660e8400-e29b-41d4-a716-4466554400i2","scenario":"intel-drift","t_offset_ms":5000,"emitted_by":"replay","kind":"disruption","subject":"2","reason":"Competitor C acquired, source removed","severity":"major","invalidates":["competitor_active"]}
{"id":"660e8400-e29b-41d4-a716-4466554400i3","scenario":"intel-drift","t_offset_ms":10000,"emitted_by":"replay","kind":"constraint_update","constraint_id":"stale_pricing","new_threshold":90,"reason":" tighten freshness to 90 days for active monitoring"}
```

- [ ] **Step 2: 创建两幕 fallback fixtures**

Create `src/env/scenarios/travel-drift.fallback.jsonl`:

```jsonl
{"id":"770e8400-e29b-41d4-a716-4466554400f1","scenario":"travel-drift","t_offset_ms":0,"emitted_by":"fixture","kind":"constraint_update","constraint_id":"time_budget","new_threshold":600,"reason":"fallback: short day"}
{"id":"770e8400-e29b-41d4-a716-4466554400f2","scenario":"travel-drift","t_offset_ms":5000,"emitted_by":"fixture","kind":"disruption","subject":"node-1","reason":"fallback: rain","severity":"minor","invalidates":["outdoor"]}
{"id":"770e8400-e29b-41d4-a716-4466554400f3","scenario":"travel-drift","t_offset_ms":10000,"emitted_by":"fixture","kind":"info_drop","target_field":"cost","target_locator":"node-1","new_value":60,"evidence":"fallback://example.com","source_trust":0.7}
```

Create `src/env/scenarios/intel-drift.fallback.jsonl`:

```jsonl
{"id":"880e8400-e29b-41d4-a716-4466554400g1","scenario":"intel-drift","t_offset_ms":0,"emitted_by":"fixture","kind":"info_drop","target_field":"pricing","target_locator":"0","new_value":"$30/mo","evidence":"fallback://example.com","source_trust":0.7}
{"id":"880e8400-e29b-41d4-a716-4466554400g2","scenario":"intel-drift","t_offset_ms":5000,"emitted_by":"fixture","kind":"disruption","subject":"1","reason":"fallback: vendor downtime","severity":"minor","invalidates":[]}
{"id":"880e8400-e29b-41d4-a716-4466554400g3","scenario":"intel-drift","t_offset_ms":10000,"emitted_by":"fixture","kind":"constraint_update","constraint_id":"stale_pricing","new_threshold":120,"reason":"fallback: loosen freshness"}
```

- [ ] **Step 3: 创建 record-stats.json(CI 闸门要求 l1Failures=0)**

Create `src/env/scenarios/travel-drift.record-stats.json`:
```json
{
  "totalCalls": 3,
  "l1Failures": 0,
  "l2Failures": 0,
  "yielded": 3,
  "fellBack": false
}
```

Create `src/env/scenarios/intel-drift.record-stats.json`:
```json
{
  "totalCalls": 3,
  "l1Failures": 0,
  "l2Failures": 0,
  "yielded": 3,
  "fellBack": false
}
```

- [ ] **Step 4: 写 intel-drift 契约测试**

Create `tests/env/scenarios/intel-drift.fixture.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LiveEnvEvent } from '../../../src/env/types.js';
import { loadContract } from '../../../src/contract/validate.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const INTEL_FIXTURE = join(__dirname, '..', '..', '..', 'src', 'env', 'scenarios', 'intel-drift.recorded.jsonl');
const INTEL_CONTRACT = join(__dirname, '..', '..', '..', 'contracts', 'intel-table-v1.yaml');

describe('intel-drift recorded fixture', () => {
  const lines = readFileSync(INTEL_FIXTURE, 'utf8').trim().split('\n');
  const events = lines.map(l => LiveEnvEvent.parse(JSON.parse(l)));

  it('has 3 events', () => {
    expect(events).toHaveLength(3);
  });

  it('all events scenario=intel-drift', () => {
    for (const e of events) expect(e.scenario).toBe('intel-drift');
  });

  it('t_offset_ms monotonically non-decreasing', () => {
    for (let i = 1; i < events.length; i++) {
      expect(events[i].t_offset_ms).toBeGreaterThanOrEqual(events[i - 1].t_offset_ms);
    }
  });

  it('all constraint_ids exist in intel-table contract', () => {
    const contract = loadContract(INTEL_CONTRACT);
    const validIds = new Set(contract.hard_constraints.map(c => c.id));
    for (const e of events) {
      if (e.kind === 'constraint_update') expect(validIds.has(e.constraint_id)).toBe(true);
    }
  });

  it('all target_fields exist in intel-table contract', () => {
    const contract = loadContract(INTEL_CONTRACT);
    const validFields = new Set(contract.fields.map(f => f.name));
    for (const e of events) {
      if (e.kind === 'info_drop') expect(validFields.has(e.target_field)).toBe(true);
    }
  });
});
```

- [ ] **Step 5: 写 fallback-parity 测试**

Create `tests/env/scenarios/fallback-parity.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LiveEnvEvent } from '../../../src/env/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCEN = join(__dirname, '..', '..', '..', 'src', 'env', 'scenarios');

function loadFixture(name: string) {
  return readFileSync(join(SCEN, name), 'utf8').trim().split('\n')
    .filter(l => l).map(l => LiveEnvEvent.parse(JSON.parse(l)));
}

describe('fallback parity (each scenario has all 3 event kinds)', () => {
  for (const sc of ['travel-drift', 'intel-drift']) {
    it(`${sc}.fallback.jsonl has ≥1 of each kind`, () => {
      const events = loadFixture(`${sc}.fallback.jsonl`);
      const kinds = new Set(events.map(e => e.kind));
      expect(kinds.has('disruption')).toBe(true);
      expect(kinds.has('info_drop')).toBe(true);
      expect(kinds.has('constraint_update')).toBe(true);
    });
  }
});
```

- [ ] **Step 6: 写 recorded-quality 测试(CI 闸门)**

Create `tests/env/scenarios/recorded-quality.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCEN = join(__dirname, '..', '..', '..', 'src', 'env', 'scenarios');

describe('recorded quality CI gate', () => {
  for (const sc of ['travel-drift', 'intel-drift']) {
    it(`${sc}.record-stats.json has 0 L1/L2 failures`, () => {
      const stats = JSON.parse(readFileSync(join(SCEN, `${sc}.record-stats.json`), 'utf8'));
      expect(stats.l1Failures).toBe(0);
      expect(stats.l2Failures).toBe(0);
    });
  }
});
```

- [ ] **Step 7: 跑全部新测试**

Run: `npx vitest run tests/env/scenarios/`
Expected: PASS(全部)

- [ ] **Step 8: typecheck + commit**

```bash
cd D:/Apps/traveller.crucible-dev
npx tsc --noEmit
git add src/env/scenarios/ tests/env/scenarios/
git commit -m "feat(env): add intel-drift fixture + both fallbacks + record-stats (CI gate)"
```

---

## Task 8: E2E intel-drift replay + record-mode mock

**Files:**
- Test: `tests/env/e2e/intel-drift-replay.test.ts`
- Test: `tests/env/e2e/record-mode.test.ts`

- [ ] **Step 1: 写 intel-drift E2E**

Create `tests/env/e2e/intel-drift-replay.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadContract } from '../../src/contract/validate.js';
import { compileContract } from '../../src/contract/compiler.js';
import { runCrucibleWorkflow } from '../../src/workflow/crucible.js';
import { intelTableBuggy } from '../../src/fixtures/intel-table.js';
import { startLiveEnv } from '../../src/env/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONTRACT_PATH = join(__dirname, '..', '..', 'contracts', 'intel-table-v1.yaml');
const FIXTURE_PATH = join(__dirname, '..', '..', 'src', 'env', 'scenarios', 'intel-drift.recorded.jsonl');

beforeEach(() => {
  delete process.env.OPENAI_API_KEY;
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

describe('E2E: intel-drift replay', () => {
  it('completes iterations with events consumed', async () => {
    const contract = loadContract(CONTRACT_PATH);
    const baseScorer = compileContract(contract);
    const handle = await startLiveEnv({
      scenario: 'intel-drift', mode: 'replay', fixturePath: FIXTURE_PATH, contract,
    });
    await handle.start();
    await new Promise(r => setTimeout(r, 50));

    const result = await runCrucibleWorkflow({
      artifact: intelTableBuggy, contract, baseScorer, artifactId: 'e2e-intel', knownStates: [], liveEnv: handle,
    });

    expect(result.iterations.length).toBeGreaterThan(0);
    const totalConsumed = result.iterations.reduce((s, it) => s + it.consumedEventIds.length, 0);
    expect(totalConsumed).toBeGreaterThanOrEqual(1);
    await handle.stop();
  }, 15000);
});
```

- [ ] **Step 2: 写 record-mode E2E(mock LLM)**

Create `tests/env/e2e/record-mode.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startLiveEnv } from '../../src/env/index.js';
import { loadContract } from '../../src/contract/validate.js';
import { dirname, join as joinPath } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONTRACT_PATH = joinPath(__dirname, '..', '..', 'contracts', 'travel-sequence-v1.yaml');
const TMP = join(tmpdir(), `crucible-e2e-rec-${Date.now()}`);

beforeEach(() => { mkdirSync(TMP, { recursive: true }); vi.spyOn(console, 'warn').mockImplementation(() => {}); });
afterEach(() => { rmSync(TMP, { recursive: true, force: true }); });

describe('E2E: record mode (mock LLM)', () => {
  it('produces JSONL + stats with 0 failures', async () => {
    const contract = loadContract(CONTRACT_PATH);
    let count = 0;
    const jsonlPath = join(TMP, 'rec.jsonl');
    const handle = await startLiveEnv({
      scenario: 'travel-drift', mode: 'record', fixturePath: jsonlPath, contract,
      callFn: async () => {
        count++;
        if (count > 2) return null;
        return { kind: 'constraint_update', constraint_id: 'time_budget', new_threshold: 500 + count, reason: `mock ${count}` };
      },
      maxEvents: 2,
    });
    await handle.start();
    await new Promise(r => setTimeout(r, 100));
    await handle.stop();

    const jsonl = readFileSync(jsonlPath, 'utf8').trim();
    expect(jsonl.length).toBeGreaterThan(0);
    const events = jsonl.split('\n').map(l => JSON.parse(l));
    expect(events).toHaveLength(2);
    expect(events[0].emitted_by).toBe('llm');

    const stats = JSON.parse(readFileSync(join(TMP, 'rec.stats.json'), 'utf8'));
    expect(stats.l1Failures).toBe(0);
    expect(stats.yielded).toBe(2);
  });
});
```

- [ ] **Step 3: 跑 E2E**

Run: `npx vitest run tests/env/e2e/`
Expected: PASS(含 Plan 1 的 travel-drift + 这两个新)

- [ ] **Step 4: commit**

```bash
cd D:/Apps/traveller.crucible-dev
git add tests/env/e2e/intel-drift-replay.test.ts tests/env/e2e/record-mode.test.ts
git commit -m "test(env): E2E intel-drift replay + record mode (mock LLM)"
```

---

## Task 9: demo-html §6 静态段 + run-live-env.mjs + npm scripts

**Files:**
- Modify: `src/demo-html.ts`(+ §6 段)
- Create: `scripts/run-live-env.mjs`
- Modify: `package.json`(+ 3 scripts)

- [ ] **Step 1: 在 demo-html.ts 加 §6 段(静态内嵌回放)**

在 `src/demo-html.ts` 的 `HtmlData` 接口加字段:
```ts
  liveEnvEvents?: import('./env/types.js').LiveEnvEvent[];
```

在 `generateHtml` 模板里(最后一个 `<hr>` 之前)加 §6:
```ts
${d.liveEnvEvents && d.liveEnvEvents.length > 0 ? `
<h2>6. Live Env(回放)</h2>
<div class="card">
  <div id="env-timeline" class="timeline"></div>
</div>
<script>
(function(){
  const events = ${JSON.stringify(d.liveEnvEvents)};
  const tl = document.getElementById('env-timeline');
  if (!tl) return;
  let i = 0;
  function playNext() {
    if (i >= events.length) return;
    const e = events[i++];
    const div = document.createElement('div');
    div.className = 'event ' + e.kind;
    div.textContent = (e.t_offset_ms/1000).toFixed(1) + 's [' + e.kind + '] ' + (e.reason || e.constraint_id || e.subject || '');
    tl.appendChild(div);
    setTimeout(playNext, Math.max(100, (events[i]?.t_offset_ms || e.t_offset_ms) - e.t_offset_ms));
  }
  playNext();
})();
</script>
` : ''}
```

在 `main()` 里(Section 5 之后)加:
```ts
  // §6 Live Env(从 travel-drift.recorded.jsonl 读)
  console.log('Section 6: Live Env replay');
  try {
    const envJsonl = readFileSync(join(__dirname, '..', 'src', 'env', 'scenarios', 'travel-drift.recorded.jsonl'), 'utf8');
    const envEvents = envJsonl.trim().split('\n').filter(l => l).map(l => JSON.parse(l));
    data.liveEnvEvents = envEvents;
  } catch { /* fixture 不存在则跳过 */ }
```

(需在文件顶部 import `readFileSync` if not already)

- [ ] **Step 2: 创建 run-live-env.mjs**

Create `scripts/run-live-env.mjs`:

```js
// 跨平台启动 Live Env demo(replay / record / export 三模式)。
// 不用 Unix "VAR=val" 前缀(Windows 不认),内部读 argv 设 env。
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TSX = join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');

// 解析 argv
const args = process.argv.slice(2);
const isExport = args.includes('--export');
const scenarioArg = args.find(a => a.startsWith('--scenario='));
const scenario = scenarioArg ? scenarioArg.split('=')[1] : 'travel-drift';
const portArg = args.find(a => a.startsWith('--port='));
const port = portArg ? portArg.split('=')[1] : '5173';
const isRecord = args.includes('--record') || process.env.CRUCIBLE_LIVE_ENV === 'record';

const env = {
  ...process.env,
  CRUCIBLE_LIVE_ENV: isRecord ? 'record' : '1',
  CRUCIBLE_LIVE_ENV_SCENARIO: scenario,
  CRUCIBLE_LIVE_ENV_PORT: port,
  ...(isExport ? { CRUCIBLE_LIVE_ENV_EXPORT: '1' } : {}),
};

const target = isExport ? 'src/env/http.ts' : 'src/env/http.ts'; // 都启 http,export 额外产出文件
const r = spawnSync(process.execPath, [TSX, target], {
  cwd: ROOT,
  stdio: 'inherit',
  env,
  shell: false,
});
process.exit(r.status ?? 1);
```

- [ ] **Step 3: 加 npm scripts**

Edit `package.json` scripts,加三行(在 `intel:monitor` 之后):

```json
    "env:demo": "node scripts/run-live-env.mjs",
    "env:demo:export": "node scripts/run-live-env.mjs --export",
    "env:record": "node scripts/run-live-env.mjs --record"
```

- [ ] **Step 4: typecheck**

Run: `npx tsc --noEmit`
Expected: 0

- [ ] **Step 5: 全量测试**

Run: `npx vitest run`
Expected: 全绿

- [ ] **Step 6: commit**

```bash
cd D:/Apps/traveller.crucible-dev
git add src/demo-html.ts scripts/run-live-env.mjs package.json
git commit -m "feat(env): add demo-html §6 + run-live-env.mjs + npm scripts (env:demo/export/record)"
```

---

## Task 10: 全量验收 + coverage

**Files:** 无新文件

- [ ] **Step 1: 全量测试 + coverage**

Run:
```bash
cd D:/Apps/traveller.crucible-dev
npx vitest run --coverage
```
Expected:
- 全部测试通过(现有 + Plan 1 ~60 + Plan 2 ~30 = ~110 新增)
- `src/env/` 整体行覆盖 ≥ 85%
- `src/env/http.ts` ≥ 70%, `src/env/event-source/llm.ts` ≥ 80%

- [ ] **Step 2: typecheck**

Run: `npx tsc --noEmit`
Expected: 0

- [ ] **Step 3: 确认零新依赖**

Run: `git diff main -- package.json | grep -E '^\+.*"dependencies"|^\+.*"devDependencies"'`
Expected: 无输出(只 scripts 段变了)

- [ ] **Step 4: 手测 env:demo(若环境允许)**

Run: `npm run env:demo -- --scenario=travel-drift`
Expected: 服务启动在 5173,浏览器打开 http://localhost:5173 看到 timeline

- [ ] **Step 5: 最终 commit**

```bash
cd D:/Apps/traveller.crucible-dev
git add -A
git commit -m "chore(env): Plan 2 complete — LLM record + safety net + HTTP/SSE + UI + dual-scenario" --allow-empty
```

---

## Plan 2 完成定义

- [ ] LLMEventSource + L1/L2/L3 安全网 + 可注入 callFn
- [ ] callLLMJson(结构化输出 + temperature/seed)
- [ ] recorder(写 JSONL + stats)
- [ ] startLiveEnv record 分支填充
- [ ] HTTP/SSE server(纯 handler + node:http + live HTML)
- [ ] demo-html §6 静态回放段
- [ ] intel-drift fixture + 两幕 fallback + record-stats
- [ ] E2E:intel-drift replay + record-mode mock
- [ ] run-live-env.mjs + 3 个 npm scripts
- [ ] 全量测试绿 + coverage ≥ 85% + 零新依赖

**两份 Plan 全部完成后**,spec §10 验收清单的 G1-G5 五大门禁可逐项检查。
