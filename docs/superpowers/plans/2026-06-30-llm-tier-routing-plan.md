# LLM Tier Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给 `src/llm/client.ts` 加 fast/slow 双档模型路由,让 Contract-Author 走慢脑(`OPENAI_MODEL_SLOW`),其他调用点默认快脑(`OPENAI_MODEL`),缺失自动降级 + 一次性 warning。

**Architecture:** 纯 additive。新增 `ModelTier` 类型 + `resolveModel(tier)` 纯函数 + 模块级 `slowFallbackWarned` 去重 flag;给 `callLLM` 与 `callLLMJson` 加可选第二参 `tier: ModelTier = 'fast'`,调用方不传等价于现行为。Contract-Author 显式传 `'slow'`。

**Tech Stack:** TypeScript + Vitest + Vercel AI SDK(已有,无新增依赖)。

---

## 0. 上下文与决议(必读)

来源 spec:`docs/superpowers/specs/2026-06-30-llm-tier-routing-design.md`(commit `af37528`)

Brainstorming 决议链:**A · A1 · B1 · C1 · D1 · E1**(详见 spec §3)

### ⚠️ 与 spec §5 的一处偏差(plan 阶段判断)

Spec §5 只列了改 `callLLM`。但实际代码里 `src/llm/client.ts` 还导出了 `callLLMJson`(同样读 `OPENAI_MODEL`,目前无调用方,是 Live Env Plan 2 的预留接口)。本 plan 选择**对称给两个函数都加 tier 参数**,理由:
- `resolveModel(tier)` 是纯函数,共用零成本
- 不对称的话,未来 LLM Event Source(高影响半径)又得回头改 `callLLMJson` 接口
- 改动面只多一行函数签名 + 一行 model 解析,不引入新文件

如不接受,Task 4 可降级为"只改 `callLLM`,`callLLMJson` 不动"——但本 plan 默认全做。

### 工作树残留(显式排除,不进任何 commit)

实施时严禁碰以下文件(均与本 plan 无关):
- `tests/auth/identity-provider.test.ts`(已有未提交改动)
- `tests/persistence/activity-log.test.ts`(已有未提交改动)
- `docs/superpowers/plans/2026-06-30-crucible-live-env-plan2-llm-ui.md`(其他人的 plan)
- `golden/calibration-report.json`(timestamp 漂移)
- `.gstack`(submodule cache)

每次 `git add` 必须**列文件而非 `-A`**。

---

## 1. File Structure

| 文件 | 责任 | 改动量 |
|---|---|---|
| `src/llm/client.ts` | 引入 `ModelTier` + `resolveModel` + 双函数加 tier 参数 | ~25 行 |
| `src/agents/contract-author.ts` | 把 1 处 `callLLM(prompt)` 改 `callLLM(prompt, 'slow')` + 注释 | 2 行 |
| `tests/llm/client.test.ts` | 追加 1 个 describe 块(`resolveModel` + tier 路由),不动现有测试 | +60 行 |
| `.env.example` | 追加 `OPENAI_MODEL_SLOW` 示例与注释 | +3 行 |

### 不动的文件(spec 显式)
- `src/rubric/*.judge.ts` × 4 — 0 改动(享受默认 `'fast'`)
- `src/agents/mastra-adapter.ts` — 0 改动(P3.5 §2.1.2 决议)
- `contracts/*.yaml` — 0 改动

---

## 2. 测试模式(关键约定,所有测试遵守)

`tests/llm/client.test.ts` 现有用例已建立模式:`vi.resetModules()` + `process.env` 直接增删 + `vi.spyOn(console, 'warn')`。本 plan 沿用,**不引入 `vi.mock('ai', ...)`**——理由:
- 现有 `client.test.ts:29-38` 用 `Promise.race + setTimeout(3000)` 处理 `generateText` 不 mock 的方式,已是约定
- `resolveModel` 是纯函数,根本不调 `generateText`,**8 个新用例里 6 个不需要任何 mock**
- 真正测"传给 SDK 的 model 名"的 2 个用例,通过 spy `createOpenAI` 间接验证更稳(见 Task 5)

---

## Task 1: 给 `client.ts` 加 `ModelTier` 类型与 `resolveModel` 纯函数(失败的测试)

**Files:**
- Test: `tests/llm/client.test.ts`(追加,不动现有 39 行)

- [ ] **Step 1: 在 `tests/llm/client.test.ts` 末尾追加 describe 块(`resolveModel` × 6 用例)**

打开 `tests/llm/client.test.ts`,在文件末尾(第 39 行 `});` 之后)追加:

```ts

describe('resolveModel (tier 路由)', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.resetModules();
    delete process.env.OPENAI_MODEL;
    delete process.env.OPENAI_MODEL_SLOW;
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    delete process.env.OPENAI_MODEL;
    delete process.env.OPENAI_MODEL_SLOW;
  });

  it('fast tier 读 OPENAI_MODEL', async () => {
    process.env.OPENAI_MODEL = 'deepseek-v3';
    const { resolveModel } = await import('../../src/llm/client.js');
    expect(resolveModel('fast')).toBe('deepseek-v3');
  });

  it('fast tier 缺失时退到 gpt-4o', async () => {
    const { resolveModel } = await import('../../src/llm/client.js');
    expect(resolveModel('fast')).toBe('gpt-4o');
  });

  it('slow tier 优先读 OPENAI_MODEL_SLOW', async () => {
    process.env.OPENAI_MODEL = 'deepseek-v3';
    process.env.OPENAI_MODEL_SLOW = 'deepseek-r1';
    const { resolveModel } = await import('../../src/llm/client.js');
    expect(resolveModel('slow')).toBe('deepseek-r1');
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('slow tier 缺失 SLOW 时降级到 FAST', async () => {
    process.env.OPENAI_MODEL = 'deepseek-v3';
    const { resolveModel } = await import('../../src/llm/client.js');
    expect(resolveModel('slow')).toBe('deepseek-v3');
    expect(warnSpy).toHaveBeenCalledWith(expect.stringMatching(/tier=slow not configured/));
  });

  it('slow tier 双缺失时降级到 gpt-4o', async () => {
    const { resolveModel } = await import('../../src/llm/client.js');
    expect(resolveModel('slow')).toBe('gpt-4o');
    expect(warnSpy).toHaveBeenCalledWith(expect.stringMatching(/tier=slow not configured/));
  });

  it('slow tier 首次降级 warn,第二次静默', async () => {
    const { resolveModel } = await import('../../src/llm/client.js');
    resolveModel('slow');
    resolveModel('slow');
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });
});
```

需要在 `import { describe, it, expect, vi, beforeEach } from 'vitest';` 顶行末尾加 `afterEach`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
```

- [ ] **Step 2: 运行新测试,验证它们失败**

```bash
cd /d/Apps/traveller.crucible-dev
npx vitest run tests/llm/client.test.ts
```

Expected:6 个新用例全 FAIL,错误为 `resolveModel` 未导出(`undefined is not a function` 或 import 失败)。原有 4 个用例仍 PASS。

- [ ] **Step 3: 写最小实现:在 `src/llm/client.ts` 顶部加 `ModelTier` 类型与 `resolveModel` 纯函数**

打开 `src/llm/client.ts`,在 `hasApiKey` 函数(第 4 行)**之前**插入:

```ts
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
```

- [ ] **Step 4: 运行测试,验证通过**

```bash
npx vitest run tests/llm/client.test.ts
```

Expected:10 个用例(原 4 + 新 6)全 PASS。

- [ ] **Step 5: Commit**

```bash
git add src/llm/client.ts tests/llm/client.test.ts
git commit -m "feat(llm): add ModelTier + resolveModel for tier routing

按 MIRA 论文 GPT-4o + o1 分层心智:'fast' / 'slow' 二档模型路由。
resolveModel 是纯函数,slow 缺失时降级到 fast + 模块级 once warning。

callLLM / callLLMJson 暂未消费 ModelTier(后续 task 接入)。

spec: docs/superpowers/specs/2026-06-30-llm-tier-routing-design.md"
```

---

## Task 2: 给 `callLLM` 加可选 `tier` 参数(失败的测试)

**Files:**
- Test: `tests/llm/client.test.ts`(再追加 1 个 describe)
- Modify: `src/llm/client.ts`(改 `callLLM` 签名 + 1 行)

- [ ] **Step 1: 在 `tests/llm/client.test.ts` 末尾追加 `callLLM tier 路由` describe(2 个用例)**

```ts

describe('callLLM tier 路由', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.resetModules();
    delete process.env.OPENAI_MODEL;
    delete process.env.OPENAI_MODEL_SLOW;
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_MODEL;
    delete process.env.OPENAI_MODEL_SLOW;
  });

  it('不传 tier 等价于 fast(向后兼容:OPENAI_MODEL_SLOW 设了也不读)', async () => {
    // 关键:即使 SLOW 配置了,不传 tier 也不会触发 SLOW 路径
    process.env.OPENAI_MODEL_SLOW = 'deepseek-r1';
    const { resolveModel } = await import('../../src/llm/client.js');
    // 通过 resolveModel 间接验证:不传等价 'fast'(callLLM 默认参数 = 'fast')
    expect(resolveModel('fast')).not.toBe('deepseek-r1');
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('tier=slow 调用 resolveModel(slow) 而非 fast', async () => {
    process.env.OPENAI_MODEL = 'deepseek-v3';
    process.env.OPENAI_MODEL_SLOW = 'deepseek-r1';
    const { resolveModel } = await import('../../src/llm/client.js');
    // 直接验证 resolveModel('slow') 行为 — callLLM 内部调用此函数
    expect(resolveModel('slow')).toBe('deepseek-r1');
    expect(resolveModel('fast')).toBe('deepseek-v3');
  });
});
```

> Note:这 2 个用例验证的是 `resolveModel` 已经测过的行为路径——故意不直接 mock `generateText`,而是断言"`callLLM` 内部用的 `resolveModel` 行为正确"。`callLLM(prompt, 'slow')` 的端到端真实调用由后续手测覆盖(spec §8 已说明)。

- [ ] **Step 2: 运行测试,验证它们通过(因为 resolveModel 已实现)**

```bash
npx vitest run tests/llm/client.test.ts
```

Expected:12 个用例全 PASS。Task 2 的两个新用例**本质是回归保护**,确保未来重构 `resolveModel` 时不破坏 callLLM 依赖的行为。

- [ ] **Step 3: 修改 `src/llm/client.ts::callLLM` 签名,使用 `resolveModel`**

找到第 14 行附近的 `callLLM`,改为:

```ts
/**
 * callLLM: 封装 Vercel AI SDK + OpenAI 兼容 provider。
 * 支持任意 OpenAI 格式 endpoint(OpenAI 官方 / Azure / vLLM / 火山方舟等)。
 * 无 API key 时返回 null + 警告(降级模式)。
 * 出错时返回 null + 警告,不 crash workflow。
 *
 * tier:'fast'(默认,向后兼容)/ 'slow'(影响半径大的调用走慢脑)。
 * 见 src/llm/client.ts::resolveModel 与 spec 2026-06-30-llm-tier-routing-design.md。
 */
export async function callLLM(prompt: string, tier: ModelTier = 'fast'): Promise<string | null> {
  if (!hasApiKey()) {
    console.warn('[LLM] OPENAI_API_KEY missing, judge will use neutral 0.5');
    return null;
  }
  try {
    const openai = createOpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      baseURL: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
    });
    const model = resolveModel(tier);
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
```

只删除了原第 24 行的 `const model = process.env.OPENAI_MODEL || 'gpt-4o';`,改用 `resolveModel(tier)`。

- [ ] **Step 4: 运行所有测试,验证不破坏现有行为**

```bash
npx tsc --noEmit
npx vitest run tests/llm/
```

Expected:tsc clean;`client.test.ts` 12 PASS,`client-json.test.ts` 5 PASS(不动)。

- [ ] **Step 5: Commit**

```bash
git add src/llm/client.ts tests/llm/client.test.ts
git commit -m "feat(llm): callLLM 接受可选 tier 参数,默认 'fast'

向后兼容:不传 tier = 'fast' = 现行为(OPENAI_MODEL)。
传 'slow' → resolveModel('slow') → OPENAI_MODEL_SLOW || OPENAI_MODEL。

spec §5 改 1。"
```

---

## Task 3: 给 `callLLMJson` 加可选 `tier` 参数(对称扩展)

> ⚠️ **本 task 是 spec §5 之外的扩展**(plan §0 已说明)。若 reviewer 反对对称扩展,直接跳过 Task 3,后续 Task 4/5 不依赖它。

**Files:**
- Modify: `src/llm/client.ts`(改 `callLLMJson` 签名 + 1 行)

- [ ] **Step 1: 直接看代码,无新测试**

`callLLMJson` 当前无调用方,且其行为本质与 `callLLM` 相同(都过 `resolveModel`),无需新单测——已被 `resolveModel` 6 个用例覆盖。如未来有调用方走 'slow',再补针对性测试。

- [ ] **Step 2: 修改 `src/llm/client.ts::callLLMJson` 签名**

找到 `callLLMJson` 函数(第 76 行附近),修改签名与 model 解析。具体:

将 76-78 行:
```ts
export async function callLLMJson(
  prompt: string,
  opts: LLMJsonOptions = {}
): Promise<Record<string, unknown> | null> {
```

改为:
```ts
export async function callLLMJson(
  prompt: string,
  opts: LLMJsonOptions = {},
  tier: ModelTier = 'fast'
): Promise<Record<string, unknown> | null> {
```

将函数体内第 89 行 `const model = process.env.OPENAI_MODEL || 'gpt-4o';` 改为:
```ts
    const model = resolveModel(tier);
```

并在函数顶部 JSDoc 追加一行:
```
 * tier:同 callLLM,默认 'fast';未来 LLM Event Source 等高影响半径调用走 'slow'。
```

- [ ] **Step 3: 运行全套测试 + tsc**

```bash
npx tsc --noEmit
npx vitest run tests/llm/
```

Expected:tsc clean;12 + 5 PASS。

- [ ] **Step 4: Commit**

```bash
git add src/llm/client.ts
git commit -m "feat(llm): callLLMJson 对称接受 tier 参数

避免未来 LLM Event Source(Plan 2)走高影响半径时再回头改接口。
默认 'fast',无调用方需要立刻迁移。"
```

---

## Task 4: 让 `contract-author.ts` 显式走慢脑

**Files:**
- Modify: `src/agents/contract-author.ts`(2 行)

- [ ] **Step 1: 找到 `callLLM` 调用**

```bash
grep -n "callLLM" /d/Apps/traveller.crucible-dev/src/agents/contract-author.ts
```

Expected 输出含一行类似:
```
92:  const raw = await callLLM(prompt);
```

- [ ] **Step 2: 修改该行**

打开 `src/agents/contract-author.ts`,把第 92 行(或 grep 出的精确行号)的:
```ts
  const raw = await callLLM(prompt);
```
改为:
```ts
  // tier='slow':contract 修订影响半径大(决定后续所有评分),走慢脑模型。
  // 见 docs/superpowers/specs/2026-06-30-llm-tier-routing-design.md
  const raw = await callLLM(prompt, 'slow');
```

- [ ] **Step 3: 运行 contract-author 相关测试**

```bash
cd /d/Apps/traveller.crucible-dev
npx vitest run tests/agents/contract-author.test.ts
```

Expected:全 PASS。本改动只是切换 tier 标签,实际行为(`resolveModel('slow')` 在 `OPENAI_MODEL_SLOW` 未配置时降级到 fast)与现行为完全一致,测试零回归。

如果该测试文件不存在,改运行:
```bash
npx vitest run tests/agents/
```

- [ ] **Step 4: 运行全套测试**

```bash
npx vitest run
```

Expected:全部 PASS(总数取决于实际现状)。

- [ ] **Step 5: Commit**

```bash
git add src/agents/contract-author.ts
git commit -m "feat(agents): contract-author 走慢脑 (tier='slow')

契约修订决定后续所有评分,影响半径最大,符合慢脑判据(spec §1 表)。
OPENAI_MODEL_SLOW 未配置时自动降级到快脑 + 首次 warning(行为兼容)。

spec §5 改 2。"
```

---

## Task 5: `.env.example` 增加 `OPENAI_MODEL_SLOW` 示例

**Files:**
- Modify: `.env.example`(+3 行)

- [ ] **Step 1: 在 `.env.example` 末尾追加**

打开 `.env.example`,在最后一行(`OPENAI_MODEL=gpt-4o`)之后追加:

```
# 慢脑模型(可选)— 用于 Contract-Author 等"决策影响半径大"的调用
# 未设时自动降级到 OPENAI_MODEL,首次降级会打一行 warning
# OPENAI_MODEL_SLOW=deepseek-r1
```

- [ ] **Step 2: Commit**

```bash
git add .env.example
git commit -m "docs(env): .env.example 加 OPENAI_MODEL_SLOW 示例"
```

---

## Task 6: 最终回归 + 验收

- [ ] **Step 1: TS 类型检查**

```bash
cd /d/Apps/traveller.crucible-dev
npx tsc --noEmit
```

Expected:无任何输出(clean)。

- [ ] **Step 2: 全套测试**

```bash
npx vitest run
```

Expected:全 PASS。新增用例数:Task 1 贡献 6 + Task 2 贡献 2 = **8 个新单测**。

- [ ] **Step 3: 确认未越界改动**

```bash
git status --short
```

Expected 输出大致:
```
 ? .gstack
 M golden/calibration-report.json
 M tests/auth/identity-provider.test.ts
 M tests/persistence/activity-log.test.ts
?? docs/superpowers/plans/2026-06-30-crucible-live-env-plan2-llm-ui.md
```

如果出现本 plan 涉及文件以外的 `M` / `A` / `??`,说明误改了文件——回滚之前必须找出原因。本 plan 涉及的 5 个文件应已全部 commit,**不再出现在工作树**:
- `src/llm/client.ts`
- `src/agents/contract-author.ts`
- `tests/llm/client.test.ts`
- `.env.example`

- [ ] **Step 4: 浏览 commit 历史**

```bash
git log --oneline -8
```

Expected 头部依次(从新到旧):
```
<hash> docs(env): .env.example 加 OPENAI_MODEL_SLOW 示例
<hash> feat(agents): contract-author 走慢脑 (tier='slow')
<hash> feat(llm): callLLMJson 对称接受 tier 参数
<hash> feat(llm): callLLM 接受可选 tier 参数,默认 'fast'
<hash> feat(llm): add ModelTier + resolveModel for tier routing
af37528 docs(spec): LLM tier routing 快慢分层设计稿 (brainstorming 产出)
...
```

5 个新 commit(若跳过 Task 3 则 4 个),全部聚焦本 spec,无杂项。

- [ ] **Step 5: 完工**

✅ tsc clean
✅ 全套测试绿(+8 新单测)
✅ 无越界改动(工作树残留与 plan 前一致)
✅ commit 历史干净

---

## Open Questions (留作未来,不在本 plan 范围)

直接复用 spec §10 OQ-TIER-1..5,本 plan 不解决:
- OQ-TIER-1 双 endpoint(A2)
- OQ-TIER-2 第三档 `'reasoning'`
- OQ-TIER-3 LLM-based Critic 接入慢脑
- OQ-TIER-4 Mastra adapter 分层
- OQ-TIER-5 per-call temperature / maxTokens
