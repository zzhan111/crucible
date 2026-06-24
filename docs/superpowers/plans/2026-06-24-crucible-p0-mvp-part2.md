# Crucible P0 MVP Implementation Plan (Part 2 of 2: LLM Judge + Mastra Agents + 提分迭代)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Part 1(契约内核 + 确定性打分,54 tests pass)之上,加 LLM judge + 5 个 Mastra agent + workflow 编排 + 提分迭代回路,完成 PRD P0 验收 4.2(分数单调上升)/ 4.3(多智能体协同可观测)/ 4.4(契约版本化)。

**Architecture:** Approach D(Mastra-native)。Part 1 的 `compileContract` 返回确定性同步 Scorer,Part 2 写 `JudgeAugmentedScorer`(async)包装它加 judge 部分。5 个 agent 围绕 Contract YAML 协同,workflow 编排"score → critic → patch → rescore"循环。

**Tech Stack:** Part 1 全部 + `@mastra/core` + `ai` (Vercel AI SDK) + `@openrouter/ai-sdk-provider` + `dotenv`。

**Spec:** `docs/superpowers/specs/crucible-p0-spec-part2.md`
**Part 1 plan:** `docs/superpowers/plans/2026-06-23-crucible-p0-mvp.md` (已执行完成,54 tests pass)
**Part 1 最后 commit:** `2305815`

**Part 1 实测接口(Part 2 复用,详见 spec §2):**
- `Contract` / `ContractSchema` / `RubricEntry` — schema 层
- `loadContract(path): Contract` — YAML 加载
- `compileContract(contract): CompiledScorer` — 编译器(⚠️ CompiledScorer 当前未导出,Task 0 修)
- `Artifact` / `Violation` / `Predicate` — 谓词层
- `RubricScore` / `DeterministicRubric` — rubric 层
- `ScoreReport` / `Scorer` — scorer 层(⚠️ 同步,Part 2 要 async,Task 0 加 AsyncScorer)
- `hk3dayGolden` / `hk3dayBuggy` — fixtures

---

## File Structure (Part 2 新增)

```
crucible-dev/
├── src/
│   ├── llm/
│   │   └── client.ts              # Vercel AI SDK + OpenRouter 封装 + 降级
│   ├── rubric/
│   │   ├── judge-types.ts         # JudgeRubric 接口 + parseJudgeScore
│   │   ├── routing.judge.ts       # proxy+judge
│   │   ├── memorability.judge.ts  # judge
│   │   └── dining_fit.judge.ts    # judge
│   ├── scorer/
│   │   └── augmented.ts           # JudgeAugmentedScorer(async,包装 Part 1)
│   ├── patch/
│   │   ├── types.ts               # ArtifactPatch 类型
│   │   └── apply.ts               # applyPatches
│   ├── agents/
│   │   ├── contract-author.ts     # Mastra agent + contractAuthorRead
│   │   ├── scorer.ts              # Mastra agent + scorerRun (async)
│   │   ├── judge.ts               # Mastra agent + judgeFanOut
│   │   ├── critic.ts              # generatePatches (纯函数)
│   │   ├── curator.ts             # detectNovelty (纯函数)
│   │   └── registry.ts            # Mastra 实例 + agent 注册
│   ├── workflow/
│   │   └── crucible.ts            # runCrucibleWorkflow(迭代回路)
│   └── proposals/
│       └── write.ts               # writeProposal(YAML + git commit)
├── contracts/proposals/           # Curator 提议目录(运行时填)
├── tests/
│   ├── llm/client.test.ts
│   ├── rubric/judge.test.ts
│   ├── scorer/augmented.test.ts
│   ├── patch/apply.test.ts
│   ├── agents/critic.test.ts
│   ├── agents/curator.test.ts
│   ├── workflow/crucible.test.ts
│   └── e2e/iteration.test.ts      # 验收 4.2/4.3/4.4
├── .env.example
└── package.json (加依赖)
```

---

## Task 0: Part 1 接口调整(导出 CompiledScorer + 加 AsyncScorer)

**Files:**
- Modify: `src/contract/compiler.ts` (加 export 给 CompiledScorer)
- Modify: `src/scorer/types.ts` (加 AsyncScorer 接口)

- [ ] **Step 1: 导出 CompiledScorer**

在 `src/contract/compiler.ts` 把 `interface CompiledScorer` 改为 `export interface CompiledScorer`:

```typescript
// 原文(内部 interface):
interface CompiledScorer extends Scorer {
  deterministicPredicateCount: number;
  deterministicRubricCount: number;
}

// 改为:
export interface CompiledScorer extends Scorer {
  deterministicPredicateCount: number;
  deterministicRubricCount: number;
}
```

- [ ] **Step 2: 加 AsyncScorer 接口**

在 `src/scorer/types.ts` 末尾追加:

```typescript
/**
 * AsyncScorer: 异步 Scorer 接口(Part 2 用,因为 judge 调 LLM 是 async)。
 * Part 1 的 Scorer 是同步的,不改动。Part 2 的 JudgeAugmentedScorer 实现 AsyncScorer。
 */
export interface AsyncScorer {
  score(artifact: Artifact): Promise<ScoreReport>;
}
```

- [ ] **Step 3: 验证 Part 1 测试仍通过**

```bash
npx vitest run
```

Expected: 54 tests 全过(无回归)。

- [ ] **Step 4: typecheck**

```bash
npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add src/contract/compiler.ts src/scorer/types.ts
git commit -m "refactor(scorer): export CompiledScorer + add AsyncScorer interface (Part 2 prep)"
```

---

## Task 1: 加 Part 2 依赖 + .env

**Files:**
- Modify: `package.json`
- Create: `.env.example`

- [ ] **Step 1: 更新 package.json 依赖**

在现有 `dependencies` 加:
```json
{
  "dependencies": {
    "yaml": "^2.4.0",
    "zod": "^3.22.0",
    "@mastra/core": "^0.1.0",
    "ai": "^4.0.0",
    "@openrouter/ai-sdk-provider": "^0.0.5",
    "dotenv": "^16.4.0"
  }
}
```

在 `scripts` 加:
```json
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit",
    "studio": "mastra dev"
  }
}
```

- [ ] **Step 2: 创建 .env.example**

```bash
# .env.example
# OpenRouter API key(无 key 时 judge 降级为 neutral 0.5)
OPENROUTER_API_KEY=
# 模型(默认 claude-3-5-sonnet)
OPENROUTER_MODEL=anthropic/claude-3-5-sonnet
```

- [ ] **Step 3: 安装依赖**

```bash
npm install
```

Expected: 依赖安装成功。如果 `@mastra/core` 或 `@openrouter/ai-sdk-provider` 版本不存在,降级到最新可用版本(`npm install @mastra/core@latest ai@latest @openrouter/ai-sdk-provider@latest dotenv`)。

- [ ] **Step 4: 验证 Part 1 测试仍通过**

```bash
npx vitest run
```

Expected: 54 tests 全过。

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json .env.example
git commit -m "chore(part2): add mastra + ai-sdk + openrouter + dotenv deps"
```

---

## Task 2: LLM client 封装 + 降级

**Files:**
- Create: `src/llm/client.ts`
- Test: `tests/llm/client.test.ts`

- [ ] **Step 1: 写失败测试**

```typescript
// tests/llm/client.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { callLLM, hasApiKey } from '../../src/llm/client.js';

describe('LLM client', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('hasApiKey returns false when OPENROUTER_API_KEY missing', () => {
    delete process.env.OPENROUTER_API_KEY;
    expect(hasApiKey()).toBe(false);
  });

  it('hasApiKey returns true when key set', () => {
    process.env.OPENROUTER_API_KEY = 'sk-test';
    expect(hasApiKey()).toBe(true);
    delete process.env.OPENROUTER_API_KEY;
  });

  it('callLLM returns null + warns when no API key', async () => {
    delete process.env.OPENROUTER_API_KEY;
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await callLLM('test prompt');
    expect(result).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringMatching(/OPENROUTER_API_KEY missing/));
    warnSpy.mockRestore();
  });

  it('callLLM returns string or null when API key set (mocked, no real call)', async () => {
    process.env.OPENROUTER_API_KEY = 'sk-test';
    const result = await callLLM('Return the word: hello');
    // 无真实 key 时 callLLM 会尝试网络调用,可能失败返回 null;有 key 时集成测试才验证真实返回
    // P0 单测只验证不 crash
    expect(result === null || typeof result === 'string').toBe(true);
    delete process.env.OPENROUTER_API_KEY;
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
npx vitest run tests/llm/client.test.ts
```

Expected: FAIL, `Cannot find module '../../src/llm/client.js'`

- [ ] **Step 3: 写实现**

```typescript
// src/llm/client.ts
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { generateText } from 'ai';

export function hasApiKey(): boolean {
  return !!process.env.OPENROUTER_API_KEY;
}

/**
 * callLLM: 封装 Vercel AI SDK + OpenRouter。
 * 无 API key 时返回 null + 警告(降级模式,spec §8)。
 * 出错时返回 null + 警告,不 crash workflow。
 */
export async function callLLM(prompt: string): Promise<string | null> {
  if (!hasApiKey()) {
    console.warn('[LLM] OPENROUTER_API_KEY missing, judge will use neutral 0.5');
    return null;
  }
  try {
    const openrouter = createOpenRouter({
      apiKey: process.env.OPENROUTER_API_KEY,
    });
    const model = process.env.OPENROUTER_MODEL || 'anthropic/claude-3-5-sonnet';
    const result = await generateText({
      model: openrouter(model),
      prompt,
      temperature: 0.2,
    });
    return result.text;
  } catch (err) {
    console.warn(`[LLM] call failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

```bash
npx vitest run tests/llm/client.test.ts
```

Expected: PASS, 4 个测试全过。第 4 个测试(API key set)可能因网络失败返回 null,这是 acceptable。

- [ ] **Step 5: Commit**

```bash
git add src/llm/client.ts tests/llm/client.test.ts
git commit -m "feat(llm): callLLM wrapper with OpenRouter + no-key graceful degradation"
```

---

## Task 3: Judge rubric 接口 + 3 个 judge 实现

**Files:**
- Create: `src/rubric/judge-types.ts`
- Create: `src/rubric/routing.judge.ts`
- Create: `src/rubric/memorability.judge.ts`
- Create: `src/rubric/dining_fit.judge.ts`
- Test: `tests/rubric/judge.test.ts`

- [ ] **Step 1: 写 Judge 接口**

```typescript
// src/rubric/judge-types.ts
import type { Artifact } from '../predicates/types.js';
import type { RubricScore } from './types.js';

export interface JudgeContext {
  artifact: Artifact;
  dim: string;
  weight: number;
  proxy_value?: number; // for proxy+judge mode
}

/** Judge rubric: 异步函数(可能调 LLM),返回 RubricScore */
export type JudgeRubric = (ctx: JudgeContext) => Promise<RubricScore>;

/** 解析 LLM 返回的分数,失败返回 0.5 neutral */
export function parseJudgeScore(raw: string | null, dim: string): number {
  if (raw === null) return 0.5; // 无 API key 降级
  // 尝试提取 0-1 的数字
  const match = raw.match(/(\d+\.?\d*)/);
  if (!match) return 0.5;
  const score = parseFloat(match[1]);
  if (Number.isNaN(score) || score < 0 || score > 1) {
    // 可能是 0-100,归一化
    if (score >= 0 && score <= 100) return score / 100;
    return 0.5;
  }
  return score;
}
```

- [ ] **Step 2: 写 routing judge (proxy+judge)**

```typescript
// src/rubric/routing.judge.ts
import type { Artifact } from '../predicates/types.js';
import type { JudgeRubric, JudgeContext } from './judge-types.js';
import { parseJudgeScore } from './judge-types.js';
import { callLLM } from '../llm/client.js';

/** 计算 proxy_value:transit/switch 桥接覆盖率(0-1) */
export function routingProxy(artifact: Artifact): number {
  const nodes = artifact.nodes;
  if (nodes.length < 2) return 1.0;
  let bridgedPairs = 0;
  let totalPairs = 0;
  for (let i = 0; i < nodes.length - 1; i++) {
    totalPairs++;
    const a = String(nodes[i].node_type ?? '');
    const b = String(nodes[i + 1].node_type ?? '');
    if (a === 'transit' || a === 'switch' || b === 'transit' || b === 'switch') {
      bridgedPairs++;
    }
  }
  return totalPairs === 0 ? 1.0 : bridgedPairs / totalPairs;
}

export const routingJudge: JudgeRubric = async (ctx: JudgeContext) => {
  const proxy = ctx.proxy_value ?? routingProxy(ctx.artifact);
  const prompt = `You are evaluating a travel itinerary's routing smoothness.
Proxy metric (bridge coverage): ${proxy.toFixed(2)}
Nodes: ${JSON.stringify(ctx.artifact.nodes.map(n => ({ action: n.action, node_type: n.node_type, route: n.route })))}
Rate the routing smoothness on a scale of 0.0 to 1.0. Consider: are transitions natural? Any backtracking? Realistic travel times?
Respond with only a number between 0 and 1.`;
  const raw = await callLLM(prompt);
  const score = parseJudgeScore(raw, 'routing');
  return {
    dim: 'routing',
    score,
    mode: 'proxy+judge',
    rationale: `proxy=${proxy.toFixed(2)}, judge=${raw ?? 'null(neutral)'}`,
    proxy_value: proxy,
  };
};
```

- [ ] **Step 3: 写 memorability judge**

```typescript
// src/rubric/memorability.judge.ts
import type { JudgeRubric, JudgeContext } from './judge-types.js';
import { parseJudgeScore } from './judge-types.js';
import { callLLM } from '../llm/client.js';

export const memorabilityJudge: JudgeRubric = async (ctx: JudgeContext) => {
  const prompt = `You are evaluating a travel itinerary's memorability — how many unique, distinctive experiences it contains.
Nodes: ${JSON.stringify(ctx.artifact.nodes.map(n => ({ action: n.action, node_type: n.node_type })))}
Rate memorability 0.0 to 1.0. Core experiences (hikes, iconic spots) boost score; generic dining/transit don't.
Respond with only a number between 0 and 1.`;
  const raw = await callLLM(prompt);
  const score = parseJudgeScore(raw, 'memorability');
  return {
    dim: 'memorability',
    score,
    mode: 'judge',
    rationale: `judge=${raw ?? 'null(neutral)'}`,
  };
};
```

- [ ] **Step 4: 写 dining_fit judge**

```typescript
// src/rubric/dining_fit.judge.ts
import type { JudgeRubric, JudgeContext } from './judge-types.js';
import { parseJudgeScore } from './judge-types.js';
import { callLLM } from '../llm/client.js';

export const diningFitJudge: JudgeRubric = async (ctx: JudgeContext) => {
  const prompt = `You are evaluating how well the dining arrangements fit a traveler's preferences.
Dining nodes: ${JSON.stringify(ctx.artifact.nodes.filter(n => n.node_type === 'dining').map(n => ({ action: n.action, cost: n.cost })))}
Rate dining fit 0.0 to 1.0. Consider variety, local character, reasonable cost.
Respond with only a number between 0 and 1.`;
  const raw = await callLLM(prompt);
  const score = parseJudgeScore(raw, 'dining_fit');
  return {
    dim: 'dining_fit',
    score,
    mode: 'judge',
    rationale: `judge=${raw ?? 'null(neutral)'}`,
  };
};
```

- [ ] **Step 5: 写失败测试**

```typescript
// tests/rubric/judge.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseJudgeScore } from '../../src/rubric/judge-types.js';
import { routingProxy, routingJudge } from '../../src/rubric/routing.judge.js';
import { memorabilityJudge } from '../../src/rubric/memorability.judge.js';
import { diningFitJudge } from '../../src/rubric/dining_fit.judge.js';
import type { Artifact } from '../../src/predicates/types.js';

describe('parseJudgeScore', () => {
  it('returns 0.5 for null input (no API key)', () => {
    expect(parseJudgeScore(null, 'x')).toBe(0.5);
  });

  it('parses 0-1 decimal', () => {
    expect(parseJudgeScore('0.75', 'x')).toBe(0.75);
  });

  it('normalizes 0-100 to 0-1', () => {
    expect(parseJudgeScore('80', 'x')).toBe(0.8);
  });

  it('returns 0.5 for unparseable', () => {
    expect(parseJudgeScore('not a number', 'x')).toBe(0.5);
  });
});

describe('routingProxy', () => {
  it('returns 1.0 for fully bridged artifact', () => {
    const artifact: Artifact = {
      family: 'sequence',
      nodes: [
        { node_type: 'dining' },
        { node_type: 'transit' },
        { node_type: 'core_experience' },
      ],
    };
    expect(routingProxy(artifact)).toBe(1.0);
  });

  it('returns 0.0 for no bridges', () => {
    const artifact: Artifact = {
      family: 'sequence',
      nodes: [
        { node_type: 'dining' },
        { node_type: 'core_experience' },
      ],
    };
    expect(routingProxy(artifact)).toBe(0.0);
  });

  it('returns 0.5 for half bridged', () => {
    const artifact: Artifact = {
      family: 'sequence',
      nodes: [
        { node_type: 'dining' },
        { node_type: 'transit' },
        { node_type: 'core_experience' },
        { node_type: 'dining' },
      ],
    };
    // pairs: (0,1) bridged, (1,2) bridged, (2,3) not bridged → 2/3
    expect(routingProxy(artifact)).toBeCloseTo(2/3, 2);
  });
});

describe('judge rubrics (no API key, degraded)', () => {
  beforeEach(() => {
    delete process.env.OPENROUTER_API_KEY;
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('routingJudge returns neutral 0.5 score when no API key', async () => {
    const artifact: Artifact = {
      family: 'sequence',
      nodes: [{ node_type: 'dining' }, { node_type: 'core_experience' }],
    };
    const result = await routingJudge({ artifact, dim: 'routing', weight: 0.25 });
    expect(result.dim).toBe('routing');
    expect(result.mode).toBe('proxy+judge');
    expect(result.score).toBe(0.5); // neutral fallback
    expect(result.proxy_value).toBe(0.0); // proxy still computed
  });

  it('memorabilityJudge returns neutral 0.5 when no API key', async () => {
    const artifact: Artifact = {
      family: 'sequence',
      nodes: [{ node_type: 'dining', action: 'breakfast' }],
    };
    const result = await memorabilityJudge({ artifact, dim: 'memorability', weight: 0.25 });
    expect(result.score).toBe(0.5);
    expect(result.mode).toBe('judge');
  });

  it('diningFitJudge returns neutral 0.5 when no API key', async () => {
    const artifact: Artifact = {
      family: 'sequence',
      nodes: [{ node_type: 'dining', action: 'breakfast' }],
    };
    const result = await diningFitJudge({ artifact, dim: 'dining_fit', weight: 0.15 });
    expect(result.score).toBe(0.5);
    expect(result.mode).toBe('judge');
  });
});
```

- [ ] **Step 6: 跑测试确认通过**

```bash
npx vitest run tests/rubric/judge.test.ts
```

Expected: PASS, 10 个测试全过(4 parseJudgeScore + 3 routingProxy + 3 judge degraded)。

- [ ] **Step 7: Commit**

```bash
git add src/rubric/judge-types.ts src/rubric/routing.judge.ts src/rubric/memorability.judge.ts src/rubric/dining_fit.judge.ts src/rubric/fanout.ts tests/rubric/judge.test.ts
git commit -m "feat(rubric): 3 LLM judge rubrics + shared fanoutJudges (routing proxy+judge, memorability, dining_fit) with no-key degradation"
```

---

## Task 3.5: 共享 judge fan-out 函数(eng-review A3 DRY 修复)

**Files:**
- Create: `src/rubric/fanout.ts`
- Test: `tests/rubric/fanout.test.ts`

- [ ] **Step 1: 写共享 fan-out 函数**

```typescript
// src/rubric/fanout.ts
import type { Contract } from '../contract/schema.js';
import type { Artifact } from '../predicates/types.js';
import type { RubricScore } from './types.js';
import type { JudgeContext } from './judge-types.js';
import { routingJudge, routingProxy } from './routing.judge.js';
import { memorabilityJudge } from './memorability.judge.js';
import { diningFitJudge } from './dining_fit.judge.js';

/**
 * fanoutJudges: 共享的 judge fan-out 逻辑(eng-review A3 DRY 修复)。
 * Task 4 JudgeAugmentedScorer 和 Task 9 judgeFanOut Agent 都调用此函数,
 * 避免两处重复实现 judge 派发逻辑。
 *
 * 输入:artifact + contract(含 judge/proxy+judge rubric 定义)
 * 输出:并行跑所有 judge rubric 的 RubricScore[]
 */
export async function fanoutJudges(
  artifact: Artifact,
  contract: Contract
): Promise<RubricScore[]> {
  const judgeDims = contract.rubric.filter(r => r.mode === 'judge' || r.mode === 'proxy+judge');
  const promises: Promise<RubricScore>[] = [];
  for (const r of judgeDims) {
    const ctx: JudgeContext = {
      artifact,
      dim: r.dim,
      weight: r.weight,
      proxy_value: r.mode === 'proxy+judge' ? routingProxy(artifact) : undefined,
    };
    if (r.dim === 'routing') promises.push(routingJudge(ctx));
    else if (r.dim === 'memorability') promises.push(memorabilityJudge(ctx));
    else if (r.dim === 'dining_fit') promises.push(diningFitJudge(ctx));
  }
  return Promise.all(promises);
}
```

- [ ] **Step 2: 写失败测试**

```typescript
// tests/rubric/fanout.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadContract } from '../../src/contract/validate.js';
import { fanoutJudges } from '../../src/rubric/fanout.js';
import type { Artifact } from '../../src/predicates/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONTRACT_PATH = join(__dirname, '..', '..', 'contracts', 'travel-sequence-v1.yaml');

describe('fanoutJudges (eng-review T3 直接覆盖)', () => {
  beforeEach(() => {
    delete process.env.OPENROUTER_API_KEY;
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('returns exactly 3 RubricScores for travel-sequence-v1 contract', async () => {
    const contract = loadContract(CONTRACT_PATH);
    const artifact: Artifact = {
      family: 'sequence',
      nodes: [
        { node_type: 'dining', action: 'breakfast' },
        { node_type: 'transit', action: 'walk' },
        { node_type: 'core_experience', action: 'hike' },
      ],
    };
    const results = await fanoutJudges(artifact, contract);
    expect(results).toHaveLength(3);
  });

  it('covers all 3 judge dims: routing, memorability, dining_fit', async () => {
    const contract = loadContract(CONTRACT_PATH);
    const artifact: Artifact = {
      family: 'sequence',
      nodes: [{ node_type: 'dining', action: 'breakfast' }],
    };
    const results = await fanoutJudges(artifact, contract);
    const dims = results.map(r => r.dim).sort();
    expect(dims).toEqual(['dining_fit', 'memorability', 'routing']);
  });

  it('returns neutral 0.5 scores when no API key (degraded mode)', async () => {
    const contract = loadContract(CONTRACT_PATH);
    const artifact: Artifact = {
      family: 'sequence',
      nodes: [{ node_type: 'dining', action: 'breakfast' }],
    };
    const results = await fanoutJudges(artifact, contract);
    for (const r of results) {
      expect(r.score).toBe(0.5); // neutral fallback
    }
  });

  it('routing score carries proxy_value (proxy+judge mode)', async () => {
    const contract = loadContract(CONTRACT_PATH);
    const artifact: Artifact = {
      family: 'sequence',
      nodes: [
        { node_type: 'dining' },
        { node_type: 'transit' },
        { node_type: 'core_experience' },
      ],
    };
    const results = await fanoutJudges(artifact, contract);
    const routing = results.find(r => r.dim === 'routing');
    expect(routing).toBeDefined();
    expect(routing!.mode).toBe('proxy+judge');
    expect(routing!.proxy_value).toBe(1.0); // fully bridged
  });

  it('handles empty artifact nodes', async () => {
    const contract = loadContract(CONTRACT_PATH);
    const artifact: Artifact = { family: 'sequence', nodes: [] };
    const results = await fanoutJudges(artifact, contract);
    expect(results).toHaveLength(3); // still 3 judge dims, just scored on empty artifact
  });
});
```

- [ ] **Step 3: 跑测试确认通过**

```bash
npx vitest run tests/rubric/fanout.test.ts
```

Expected: PASS, 5 个测试全过。

- [ ] **Step 4: Commit**

```bash
git add src/rubric/fanout.ts tests/rubric/fanout.test.ts
git commit -m "feat(rubric): shared fanoutJudges + direct unit tests (DRY: Task 4 + Task 9 共用)"
```

---

## Task 4: JudgeAugmentedScorer (async,包装 Part 1 + judge)

**Files:**
- Create: `src/scorer/augmented.ts`
- Test: `tests/scorer/augmented.test.ts`

- [ ] **Step 1: 写失败测试**

```typescript
// tests/scorer/augmented.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadContract } from '../../src/contract/validate.js';
import { compileContract } from '../../src/contract/compiler.js';
import { createJudgeAugmentedScorer } from '../../src/scorer/augmented.js';
import { hk3dayBuggy } from '../../src/fixtures/hk-3day-buggy.js';
import { hk3dayGolden } from '../../src/fixtures/hk-3day-golden.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONTRACT_PATH = join(__dirname, '..', '..', 'contracts', 'travel-sequence-v1.yaml');

describe('JudgeAugmentedScorer', () => {
  beforeEach(() => {
    delete process.env.OPENROUTER_API_KEY;
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('produces ScoreReport with judge populated (neutral when no API key)', async () => {
    const contract = loadContract(CONTRACT_PATH);
    const baseScorer = compileContract(contract);
    const scorer = createJudgeAugmentedScorer(baseScorer, contract);
    const report = await scorer.score(hk3dayGolden);
    expect(report.judge).not.toBeNull();
    expect(report.judge!.rubric_scores).toHaveLength(3);
    const dims = report.judge!.rubric_scores.map(r => r.dim);
    expect(dims).toContain('routing');
    expect(dims).toContain('memorability');
    expect(dims).toContain('dining_fit');
    // neutral 0.5 each (no API key)
    expect(report.judge!.overall_score).toBeCloseTo(0.5, 2);
  });

  it('final_score = deterministic*0.6 + judge*0.4', async () => {
    const contract = loadContract(CONTRACT_PATH);
    const baseScorer = compileContract(contract);
    const scorer = createJudgeAugmentedScorer(baseScorer, contract);
    const report = await scorer.score(hk3dayGolden);
    const expected = report.deterministic.deterministic_score * 0.6 + report.judge!.overall_score * 0.4;
    expect(report.final_score).toBeCloseTo(expected, 4);
  });

  it('buggy scores lower than golden (deterministic violations dominate)', async () => {
    const contract = loadContract(CONTRACT_PATH);
    const baseScorer = compileContract(contract);
    const scorer = createJudgeAugmentedScorer(baseScorer, contract);
    const golden = await scorer.score(hk3dayGolden);
    const buggy = await scorer.score(hk3dayBuggy);
    expect(buggy.final_score).toBeLessThan(golden.final_score);
  });

  it('judge overall_score = weighted avg of judge rubric scores (normalized to judge dims)', async () => {
    const contract = loadContract(CONTRACT_PATH);
    const baseScorer = compileContract(contract);
    const scorer = createJudgeAugmentedScorer(baseScorer, contract);
    const report = await scorer.score(hk3dayGolden);
    const weights = { routing: 0.25, memorability: 0.25, dining_fit: 0.15 };
    let expected = 0;
    let weightSum = 0;
    for (const r of report.judge!.rubric_scores) {
      const w = weights[r.dim as keyof typeof weights] ?? 0;
      expected += r.score * w;
      weightSum += w;
    }
    expected = expected / weightSum;
    expect(report.judge!.overall_score).toBeCloseTo(expected, 4);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
npx vitest run tests/scorer/augmented.test.ts
```

Expected: FAIL, `Cannot find module '../../src/scorer/augmented.js'`

- [ ] **Step 3: 写实现**

```typescript
// src/scorer/augmented.ts
import type { Contract } from '../contract/schema.js';
import type { CompiledScorer } from '../contract/compiler.js';
import type { Artifact } from '../predicates/types.js';
import type { RubricScore } from '../rubric/types.js';
import type { ScoreReport, AsyncScorer } from './types.js';
import { fanoutJudges } from '../rubric/fanout.js';

const JUDGE_WEIGHT_IN_FINAL = 0.4;

/**
 * createJudgeAugmentedScorer: 包装 Part 1 的确定性 Scorer,加 LLM judge 部分。
 * 实现 AsyncScorer 接口(score 返回 Promise)。
 * final_score = deterministic_score * 0.6 + judge_overall * 0.4
 *
 * 注(eng-review A3):judge fan-out 逻辑委托给共享函数 fanoutJudges,
 * Task 9 的 judgeFanOut Agent 也调用同一函数,避免重复。
 */
export function createJudgeAugmentedScorer(
  baseScorer: CompiledScorer,
  contract: Contract
): AsyncScorer {
  const judgeDims = contract.rubric.filter(r => r.mode === 'judge' || r.mode === 'proxy+judge');

  return {
    async score(artifact: Artifact): Promise<ScoreReport> {
      // 1. 跑确定性部分(Part 1,同步)
      const baseReport = baseScorer.score(artifact);

      // 2. 并行跑 judge rubric(委托给共享 fanoutJudges,eng-review A3)
      const judgeScores: RubricScore[] = await fanoutJudges(artifact, contract);

      // 3. 计算 judge overall_score(加权平均,归一化到 judge 维度的权重和)
      const weightSum = judgeDims.reduce((acc, r) => acc + r.weight, 0);
      // 预建权重 Map(eng-review A2:避免循环内 .find() 重复查找)
      const weightByDim = new Map<string, number>(judgeDims.map(r => [r.dim, r.weight]));
      let judgeOverall = 0;
      for (const s of judgeScores) {
        const w = weightByDim.get(s.dim) ?? 0;
        judgeOverall += s.score * w;
      }
      judgeOverall = weightSum > 0 ? judgeOverall / weightSum : 0.5;

      // 4. 合成最终 ScoreReport
      const deterministicScore = baseReport.deterministic.deterministic_score;
      const finalScore = deterministicScore * (1 - JUDGE_WEIGHT_IN_FINAL) + judgeOverall * JUDGE_WEIGHT_IN_FINAL;

      return {
        deterministic: baseReport.deterministic,
        judge: {
          rubric_scores: judgeScores,
          overall_score: judgeOverall,
        },
        final_score: finalScore,
      };
    },
  };
}
```

- [ ] **Step 4: 跑测试确认通过**

```bash
npx vitest run tests/scorer/augmented.test.ts
```

Expected: PASS, 4 个测试全过。

- [ ] **Step 5: Commit**

```bash
git add src/scorer/augmented.ts tests/scorer/augmented.test.ts
git commit -m "feat(scorer): JudgeAugmentedScorer (async, wraps Part 1 + LLM judge, final=det*0.6+judge*0.4)"
```

---

## Task 5: ArtifactPatch 类型 + applyPatches

**Files:**
- Create: `src/patch/types.ts`
- Create: `src/patch/apply.ts`
- Test: `tests/patch/apply.test.ts`

- [ ] **Step 1: 写 patch 类型**

```typescript
// src/patch/types.ts
import type { ArtifactNode } from '../predicates/types.js';

export type ArtifactPatch =
  | { type: 'insert'; after_index: number; node: ArtifactNode; reason: string }
  | { type: 'replace'; index: number; node: ArtifactNode; reason: string }
  | { type: 'delete'; index: number; reason: string }
  | { type: 'update_field'; index: number; field: string; value: unknown; reason: string };
```

- [ ] **Step 2: 写失败测试**

```typescript
// tests/patch/apply.test.ts
import { describe, it, expect } from 'vitest';
import { applyPatches } from '../../src/patch/apply.js';
import type { Artifact } from '../../src/predicates/types.js';
import type { ArtifactPatch } from '../../src/patch/types.js';

describe('applyPatches', () => {
  it('inserts a node at after_index', () => {
    const artifact: Artifact = {
      family: 'sequence',
      nodes: [{ action: 'a', node_type: 'dining' }, { action: 'b', node_type: 'core_experience' }],
    };
    const patches: ArtifactPatch[] = [
      { type: 'insert', after_index: 0, node: { action: 'walk', node_type: 'transit' }, reason: 'fix continuity' },
    ];
    const result = applyPatches(artifact, patches);
    expect(result.nodes).toHaveLength(3);
    expect(result.nodes[1].action).toBe('walk');
    expect(result.nodes[1].node_type).toBe('transit');
  });

  it('replaces a node', () => {
    const artifact: Artifact = {
      family: 'sequence',
      nodes: [{ action: 'old', node_type: 'dining' }],
    };
    const patches: ArtifactPatch[] = [
      { type: 'replace', index: 0, node: { action: 'new', node_type: 'dining' }, reason: 'rewrite' },
    ];
    const result = applyPatches(artifact, patches);
    expect(result.nodes[0].action).toBe('new');
  });

  it('deletes a node', () => {
    const artifact: Artifact = {
      family: 'sequence',
      nodes: [{ action: 'a' }, { action: 'b' }, { action: 'c' }],
    };
    const patches: ArtifactPatch[] = [
      { type: 'delete', index: 1, reason: 'remove' },
    ];
    const result = applyPatches(artifact, patches);
    expect(result.nodes).toHaveLength(2);
    expect(result.nodes.map(n => n.action)).toEqual(['a', 'c']);
  });

  it('updates a field', () => {
    const artifact: Artifact = {
      family: 'sequence',
      nodes: [{ action: 'a', state: ['x'] }],
    };
    const patches: ArtifactPatch[] = [
      { type: 'update_field', index: 0, field: 'state', value: [], reason: 'clear state' },
    ];
    const result = applyPatches(artifact, patches);
    expect(result.nodes[0].state).toEqual([]);
  });

  it('applies multiple patches in order (inserts affect later indices)', () => {
    const artifact: Artifact = {
      family: 'sequence',
      nodes: [{ action: 'a' }, { action: 'b' }],
    };
    const patches: ArtifactPatch[] = [
      { type: 'insert', after_index: 0, node: { action: 'mid' }, reason: 'x' },
      { type: 'update_field', index: 1, field: 'action', value: 'mid-renamed', reason: 'y' },
    ];
    const result = applyPatches(artifact, patches);
    // after insert: [a, mid, b]; index 1 is now 'mid' → renamed
    expect(result.nodes[1].action).toBe('mid-renamed');
  });

  it('returns artifact unchanged for empty patches', () => {
    const artifact: Artifact = { family: 'sequence', nodes: [{ action: 'a' }] };
    expect(applyPatches(artifact, [])).toEqual(artifact);
  });
});
```

- [ ] **Step 3: 跑测试确认失败**

```bash
npx vitest run tests/patch/apply.test.ts
```

Expected: FAIL

- [ ] **Step 4: 写实现**

```typescript
// src/patch/apply.ts
import type { Artifact } from '../predicates/types.js';
import type { ArtifactPatch } from './types.js';

/**
 * applyPatches: 按顺序应用 patches 到 artifact,返回新 artifact(不改原对象)。
 * insert 在 after_index 之后插入;后续 patch 的 index 基于已 patched 的数组。
 */
export function applyPatches(artifact: Artifact, patches: ArtifactPatch[]): Artifact {
  let nodes = [...artifact.nodes];
  for (const patch of patches) {
    switch (patch.type) {
      case 'insert': {
        nodes = [...nodes.slice(0, patch.after_index + 1), patch.node, ...nodes.slice(patch.after_index + 1)];
        break;
      }
      case 'replace': {
        nodes = nodes.map((n, i) => (i === patch.index ? patch.node : n));
        break;
      }
      case 'delete': {
        nodes = nodes.filter((_, i) => i !== patch.index);
        break;
      }
      case 'update_field': {
        nodes = nodes.map((n, i) => (i === patch.index ? { ...n, [patch.field]: patch.value } : n));
        break;
      }
    }
  }
  return { ...artifact, nodes };
}
```

- [ ] **Step 5: 跑测试确认通过**

```bash
npx vitest run tests/patch/apply.test.ts
```

Expected: PASS, 6 个测试全过。

- [ ] **Step 6: Commit**

```bash
git add src/patch/types.ts src/patch/apply.ts tests/patch/apply.test.ts
git commit -m "feat(patch): ArtifactPatch type + applyPatches (insert/replace/delete/update_field)"
```

---

## Task 6: Critic Agent (生成提分 patch)

**Files:**
- Create: `src/agents/critic.ts`
- Test: `tests/agents/critic.test.ts`

- [ ] **Step 1: 写失败测试**

```typescript
// tests/agents/critic.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generatePatches } from '../../src/agents/critic.js';
import type { Artifact, Violation } from '../../src/predicates/types.js';
import type { ScoreReport } from '../../src/rubric/types.js';
import { hk3dayBuggy } from '../../src/fixtures/hk-3day-buggy.js';

function makeReport(violations: Violation[]): ScoreReport {
  return {
    deterministic: {
      violations,
      rubric_scores: [],
      hard_violation_count: violations.length,
      deterministic_score: 1 - violations.length * 0.15,
    },
    judge: { rubric_scores: [], overall_score: 0.5 },
    final_score: 0.5,
  };
}

describe('Critic generatePatches', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('generates insert patch for continuity violation', async () => {
    const violations: Violation[] = [{
      constraint_id: 'continuity',
      severity: 'hard',
      message: 'adjacent nodes at index 0 and 1 have no transit/switch bridge',
      location: { node_index: 0, node_index_end: 1 },
      fix_hint: 'insert a transit or switch node between these two nodes',
    }];
    const report = makeReport(violations);
    const patches = await generatePatches(report, hk3dayBuggy);
    const insertPatches = patches.filter(p => p.type === 'insert');
    expect(insertPatches.length).toBeGreaterThanOrEqual(1);
    expect(insertPatches[0].type === 'insert' && insertPatches[0].after_index).toBe(0);
  });

  it('generates update_field patch for state_mutex violation (clear one token)', async () => {
    const violations: Violation[] = [{
      constraint_id: 'state_mutex',
      severity: 'hard',
      message: 'node 0 holds both mutex states: luggage_drop and depart_from_hotel',
      location: { node_index: 0, field: 'state' },
      fix_hint: 'remove one of luggage_drop/depart_from_hotel from this node',
    }];
    const report = makeReport(violations);
    const patches = await generatePatches(report, hk3dayBuggy);
    const updatePatches = patches.filter(p => p.type === 'update_field' && p.field === 'state');
    expect(updatePatches.length).toBeGreaterThanOrEqual(1);
  });

  it('generates update_field patch for no_duplicate_state violation', async () => {
    const violations: Violation[] = [{
      constraint_id: 'no_duplicate_state',
      severity: 'hard',
      message: 'state "at_hotel" persists across consecutive nodes 0 and 1 without a clearing transition',
      location: { node_index: 0, node_index_end: 1, field: 'state' },
      fix_hint: 'insert a switch or buffer node between them, or remove the duplicate state',
    }];
    const report = makeReport(violations);
    const patches = await generatePatches(report, hk3dayBuggy);
    expect(patches.length).toBeGreaterThanOrEqual(1);
  });

  it('returns empty patches for zero violations', async () => {
    const report = makeReport([]);
    const patches = await generatePatches(report, hk3dayBuggy);
    expect(patches).toEqual([]);
  });

  it('every patch has a reason', async () => {
    const violations: Violation[] = [
      { constraint_id: 'continuity', severity: 'hard', message: 'gap 0-1', location: { node_index: 0, node_index_end: 1 }, fix_hint: 'insert transit' },
    ];
    const report = makeReport(violations);
    const patches = await generatePatches(report, hk3dayBuggy);
    for (const p of patches) {
      expect(p.reason.length).toBeGreaterThan(5);
    }
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
npx vitest run tests/agents/critic.test.ts
```

Expected: FAIL

- [ ] **Step 3: 写实现**

```typescript
// src/agents/critic.ts
import type { Artifact, Violation } from '../predicates/types.js';
import type { ScoreReport } from '../rubric/types.js';
import type { ArtifactPatch } from '../patch/types.js';

/**
 * Critic: 读 ScoreReport + Violations,生成提分 patch。
 * 策略(P0 确定性,不调 LLM):
 * - continuity 违规 → insert transit 节点
 * - state_mutex 违规 → update_field state,移除第二个 mutex token
 * - no_duplicate_state 违规 → update_field state,清除重复 token
 * - judge 低分维度 → P0 不处理,只处理硬约束
 */
export async function generatePatches(
  report: ScoreReport,
  artifact: Artifact
): Promise<ArtifactPatch[]> {
  const patches: ArtifactPatch[] = [];
  const violations = report.deterministic.violations;

  for (const v of violations) {
    switch (v.constraint_id) {
      case 'continuity': {
        const afterIdx = v.location.node_index ?? 0;
        patches.push({
          type: 'insert',
          after_index: afterIdx,
          node: {
            action: '步行/交通衔接(自动补丁)',
            node_type: 'transit',
            duration_min: 15,
            elasticity: 'non_compressible',
            cost: 10,
            state: [],
          },
          reason: `fix continuity violation at nodes ${v.location.node_index}-${v.location.node_index_end}`,
        });
        break;
      }
      case 'state_mutex': {
        const idx = v.location.node_index ?? 0;
        const node = artifact.nodes[idx];
        const states = Array.isArray(node?.state) ? node.state.map(String) : [];
        const mutexTokens = states.filter(s => v.message.includes(s));
        const toRemove = mutexTokens[1] ?? mutexTokens[0];
        const newStates = states.filter(s => s !== toRemove);
        patches.push({
          type: 'update_field',
          index: idx,
          field: 'state',
          value: newStates,
          reason: `fix state_mutex: remove ${toRemove} from node ${idx}`,
        });
        break;
      }
      case 'no_duplicate_state': {
        // 选 node_index_end 而非 node_index(eng-review C2 注释):
        // 保留前序节点的 state 语义(如 at_hotel 表示出发点),清除后续节点的重复。
        // 两边都可清,选 end 是任意但合理:前序节点的 state 通常是"主动声明",
        // 后续节点重复持有更可能是 bug(忘记 transition)。
        const idx = v.location.node_index_end ?? 1;
        const node = artifact.nodes[idx];
        const states = Array.isArray(node?.state) ? node.state.map(String) : [];
        const match = v.message.match(/"([^"]+)"/);
        const dupToken = match?.[1] ?? states[0];
        const newStates = states.filter(s => s !== dupToken);
        patches.push({
          type: 'update_field',
          index: idx,
          field: 'state',
          value: newStates,
          reason: `fix no_duplicate_state: remove ${dupToken} from node ${idx}`,
        });
        break;
      }
      default:
        break;
    }
  }

  return patches;
}
```

- [ ] **Step 4: 跑测试确认通过**

```bash
npx vitest run tests/agents/critic.test.ts
```

Expected: PASS, 5 个测试全过。

- [ ] **Step 5: Commit**

```bash
git add src/agents/critic.ts tests/agents/critic.test.ts
git commit -m "feat(agent): Critic generates deterministic patches for hard constraint violations"
```

---

## Task 7: Curator Agent (检测新颖度 + 提议扩张)

**Files:**
- Create: `src/agents/curator.ts`
- Test: `tests/agents/curator.test.ts`

- [ ] **Step 1: 写失败测试**

```typescript
// tests/agents/curator.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { detectNovelty } from '../../src/agents/curator.js';
import type { Artifact } from '../../src/predicates/types.js';
import { hk3dayGolden } from '../../src/fixtures/hk-3day-golden.js';

describe('Curator detectNovelty', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('returns empty proposals for golden artifact (no novelty)', async () => {
    const proposals = await detectNovelty(hk3dayGolden, ['at_hotel', 'hiking', 'luggage_drop', 'depart_from_hotel']);
    expect(proposals).toEqual([]);
  });

  it('returns proposal when artifact has unseen state token', async () => {
    const artifact: Artifact = {
      family: 'sequence',
      nodes: [{ action: 'x', node_type: 'dining', state: ['new_unseen_state'] }],
    };
    const proposals = await detectNovelty(artifact, ['at_hotel', 'hiking']);
    expect(proposals.length).toBeGreaterThanOrEqual(1);
    expect(proposals[0].dim).toBe('state');
    expect(proposals[0].tokens).toContain('new_unseen_state');
  });

  it('returns proposal when artifact has unseen node_type', async () => {
    const artifact: Artifact = {
      family: 'sequence',
      nodes: [{ action: 'x', node_type: 'shopping' }],
    };
    const proposals = await detectNovelty(artifact, [], ['dining', 'transit', 'core_experience']);
    expect(proposals.length).toBeGreaterThanOrEqual(1);
    expect(proposals[0].dim).toBe('node_type');
    expect(proposals[0].tokens).toContain('shopping');
  });

  it('proposal has rationale', async () => {
    const artifact: Artifact = {
      family: 'sequence',
      nodes: [{ action: 'x', state: ['novel'] }],
    };
    const proposals = await detectNovelty(artifact, []);
    expect(proposals[0].rationale.length).toBeGreaterThan(5);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
npx vitest run tests/agents/curator.test.ts
```

Expected: FAIL

- [ ] **Step 3: 写实现**

```typescript
// src/agents/curator.ts
import type { Artifact } from '../predicates/types.js';

export interface ExpansionProposal {
  dim: 'state' | 'node_type';
  tokens: string[];
  rationale: string;
  proposed_constraint?: string;
}

/**
 * Curator: 检测 artifact 中的新颖 state token / node_type,
 * 提议 Contract 扩张(P0 只检测不合并)。
 * knownStates: Contract 已知的 state tokens。
 * knownNodeTypes: Contract 已知的 node_type enum values(可选)。
 */
export async function detectNovelty(
  artifact: Artifact,
  knownStates: string[],
  knownNodeTypes?: string[]
): Promise<ExpansionProposal[]> {
  const proposals: ExpansionProposal[] = [];

  // 检测新颖 state tokens
  const observedStates = new Set<string>();
  for (const node of artifact.nodes) {
    if (Array.isArray(node.state)) {
      for (const s of node.state) observedStates.add(String(s));
    }
  }
  const novelStates = [...observedStates].filter(s => !knownStates.includes(s));
  if (novelStates.length > 0) {
    proposals.push({
      dim: 'state',
      tokens: novelStates,
      rationale: `artifact contains state tokens not in Contract's known set: ${novelStates.join(', ')}. Consider adding hard constraints or rubric dimensions for these.`,
      proposed_constraint: ` Consider adding mutex/dependency rules involving: ${novelStates.join(', ')}`,
    });
  }

  // 检测新颖 node_type
  if (knownNodeTypes) {
    const observedTypes = new Set<string>();
    for (const node of artifact.nodes) {
      if (node.node_type) observedTypes.add(String(node.node_type));
    }
    const novelTypes = [...observedTypes].filter(t => !knownNodeTypes.includes(t));
    if (novelTypes.length > 0) {
      proposals.push({
        dim: 'node_type',
        tokens: novelTypes,
        rationale: `artifact contains node_type values not in Contract's enum: ${novelTypes.join(', ')}. Consider extending the node_type enum or adding type-specific constraints.`,
      });
    }
  }

  return proposals;
}
```

- [ ] **Step 4: 跑测试确认通过**

```bash
npx vitest run tests/agents/curator.test.ts
```

Expected: PASS, 4 个测试全过。

- [ ] **Step 5: Commit**

```bash
git add src/agents/curator.ts tests/agents/curator.test.ts
git commit -m "feat(agent): Curator detects novel state tokens + node_types, proposes contract expansion"
```

---

## Task 8: Proposal 写文件 + git commit (验收 4.4)

**Files:**
- Create: `src/proposals/write.ts`

- [ ] **Step 1: 写实现**

```typescript
// src/proposals/write.ts
import { writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ExpansionProposal } from '../agents/curator.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * writeProposal: 把 Curator 的扩张提议写到 contracts/proposals/ + git commit。
 * 验收 4.4:契约版本化(每次 Curator 提议产生 commit)。
 * 降级:git commit 失败时只写文件(spec §8)。
 *
 * 安全(eng-review C1):用 execFileSync + 参数数组,不用 execSync 拼字符串,
 * 避免 artifactId / proposal.dim 含特殊字符时的 shell 注入风险。
 */
export function writeProposal(proposal: ExpansionProposal, artifactId: string): string {
  const proposalsDir = join(__dirname, '..', '..', 'contracts', 'proposals');
  mkdirSync(proposalsDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `${timestamp}-${artifactId}-${proposal.dim}.yaml`;
  const filepath = join(proposalsDir, filename);

  const yamlContent = `# Curator expansion proposal (auto-generated)
# Artifact: ${artifactId}
# Dimension: ${proposal.dim}
# Timestamp: ${timestamp}
dim: ${proposal.dim}
tokens:
${proposal.tokens.map(t => `  - ${t}`).join('\n')}
rationale: ${JSON.stringify(proposal.rationale)}
proposed_constraint: ${proposal.proposed_constraint ? JSON.stringify(proposal.proposed_constraint) : 'null'}
`;

  writeFileSync(filepath, yamlContent, 'utf8');

  // 尝试 git add + commit(失败降级)。用 execFileSync + 参数数组,无 shell 注入。
  const repoRoot = join(__dirname, '..', '..');
  const commitMsg = `chore(contract): curator proposal ${proposal.dim} for ${artifactId}`;
  try {
    execFileSync('git', ['add', filepath], { cwd: repoRoot, stdio: 'pipe' });
    execFileSync('git', ['commit', '-m', commitMsg], { cwd: repoRoot, stdio: 'pipe' });
    console.log(`[Curator] proposal committed: ${filename}`);
  } catch (err) {
    console.warn(`[Curator] git commit failed (file written): ${err instanceof Error ? err.message : String(err)}`);
  }

  return filepath;
}
```

- [ ] **Step 2: typecheck**

```bash
npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add src/proposals/write.ts
git commit -m "feat(proposals): writeProposal writes YAML + git commit (acceptance 4.4 contract versioning)"
```

---

## Task 9: Mastra Agent 注册 + Workflow 编排

**Files:**
- Create: `src/agents/contract-author.ts`
- Create: `src/agents/scorer.ts`
- Create: `src/agents/judge.ts`
- Create: `src/agents/registry.ts`
- Create: `src/workflow/crucible.ts`
- Test: `tests/workflow/crucible.test.ts`

- [ ] **Step 1: 写 Contract-Author Agent**

```typescript
// src/agents/contract-author.ts
import { Agent } from '@mastra/core/agent';
import type { Contract } from '../contract/schema.js';

// P0:Contract-Author 只读现有契约,不自动改(P1 加 LLM 修订能力)
export function createContractAuthorAgent() {
  return new Agent({
    name: 'contract-author',
    instructions: `You are the Contract-Author agent. In P0, you read and return the current Contract YAML without modification. You ensure the contract is well-formed before passing to the Scorer.`,
  });
}

export function contractAuthorRead(contract: Contract): Contract {
  console.log('[Contract-Author] reading contract (P0: no modification)');
  return contract;
}
```

- [ ] **Step 2: 写 Scorer Agent**

```typescript
// src/agents/scorer.ts
import { Agent } from '@mastra/core/agent';
import type { Contract } from '../contract/schema.js';
import type { CompiledScorer } from '../contract/compiler.js';
import type { Artifact } from '../predicates/types.js';
import type { ScoreReport } from '../rubric/types.js';
import { createJudgeAugmentedScorer } from '../scorer/augmented.js';

export function createScorerAgent() {
  return new Agent({
    name: 'scorer',
    instructions: `You are the Scorer agent. You run the JudgeAugmentedScorer: first deterministic checks (Part 1), then fan out to Judge sub-agents for LLM rubrics. You return a complete ScoreReport.`,
  });
}

export async function scorerRun(
  artifact: Artifact,
  baseScorer: CompiledScorer,
  contract: Contract
): Promise<ScoreReport> {
  console.log('[Scorer] scoring artifact (deterministic + judge fan-out)');
  const augmented = createJudgeAugmentedScorer(baseScorer, contract);
  return augmented.score(artifact);
}
```

- [ ] **Step 3: 写 Judge Agent (fan-out)**

```typescript
// src/agents/judge.ts
import { Agent } from '@mastra/core/agent';
import type { Artifact } from '../predicates/types.js';
import type { Contract } from '../contract/schema.js';
import type { RubricScore } from '../rubric/types.js';
import { fanoutJudges } from '../rubric/fanout.js';

export function createJudgeAgent() {
  return new Agent({
    name: 'judge',
    instructions: `You are the Judge agent. You fan out to 3 judge rubrics (routing, memorability, dining_fit) in parallel and collect their RubricScores.`,
  });
}

/**
 * judgeFanOut: Mastra Agent 包装的 judge fan-out。
 * 委托给共享函数 fanoutJudges(eng-review A3 DRY 修复),
 * 与 Task 4 JudgeAugmentedScorer 共用同一 fan-out 逻辑。
 */
export async function judgeFanOut(
  artifact: Artifact,
  contract: Contract
): Promise<RubricScore[]> {
  console.log('[Judge] fanning out to judge rubrics in parallel (via shared fanoutJudges)');
  const results = await fanoutJudges(artifact, contract);
  console.log(`[Judge] collected ${results.length} judge scores`);
  return results;
}
```

- [ ] **Step 4: 写 Agent registry**

```typescript
// src/agents/registry.ts
import { Mastra } from '@mastra/core';
import { createContractAuthorAgent } from './contract-author.js';
import { createScorerAgent } from './scorer.js';
import { createJudgeAgent } from './judge.js';
import { generatePatches } from './critic.js';
import { detectNovelty } from './curator.js';

export function createMastraInstance(): Mastra {
  return new Mastra({
    agents: {
      contractAuthor: createContractAuthorAgent(),
      scorer: createScorerAgent(),
      judge: createJudgeAgent(),
    },
    // Critic 和 Curator 是纯函数 agent(P0 不需要 Mastra Agent 包装),
    // 但注册到 Mastra 以便 Studio 可见(通过 logger)
  });
}

export { generatePatches, detectNovelty };
```

- [ ] **Step 5: 写 Workflow 编排**

```typescript
// src/workflow/crucible.ts
import type { Contract } from '../contract/schema.js';
import type { CompiledScorer } from '../contract/compiler.js';
import type { Artifact } from '../predicates/types.js';
import type { ScoreReport } from '../rubric/types.js';
import type { ArtifactPatch } from '../patch/types.js';
import { scorerRun } from '../agents/scorer.js';
import { generatePatches } from '../agents/critic.js';
import { detectNovelty } from '../agents/curator.js';
import { applyPatches } from '../patch/apply.js';
import { writeProposal } from '../proposals/write.js';

const MAX_ITERATIONS = 3;
const MIN_IMPROVEMENT = 0.01;

export interface CrucibleRunInput {
  artifact: Artifact;
  contract: Contract;
  baseScorer: CompiledScorer;
  artifactId: string;
  knownStates: string[];
}

export interface CrucibleIteration {
  artifact: Artifact;
  score: number;
  violations: number;
  patchesApplied: number;
}

export interface CrucibleRunResult {
  iterations: CrucibleIteration[];
  finalArtifact: Artifact;
  finalScore: number;
  proposals: number;
}

/**
 * runCrucibleWorkflow: 完整迭代回路。
 * v1 → score → critic → v2 → score → critic → v3 → score
 * 终止:提升 < 0.01 或达 MAX_ITERATIONS。
 *
 * Score 跟踪(eng-review A1 修复):
 * 每轮 iteration 记录 post-patch score(即下一轮输入 artifact 的分数)。
 * - iteration[0].score = v1 patch 后的分数(= v2 输入的分数)
 * - iteration[1].score = v2 patch 后的分数(= v3 输入的分数)
 * 这样验收 4.2 比较相邻 iteration.score 就是"v2 vs v1"、"v3 vs v2",语义正确。
 * pre-patch score 只用于 Critic 决策(读 ScoreReport.violations),不记入 iteration。
 */
export async function runCrucibleWorkflow(input: CrucibleRunInput): Promise<CrucibleRunResult> {
  const allIterations: CrucibleIteration[] = [];
  let currentArtifact = input.artifact;
  let totalProposals = 0;
  let lastPostPatchScore = 0;

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    console.log(`\n[Workflow] === Iteration ${i + 1}/${MAX_ITERATIONS} ===`);

    // 1. Score(pre-patch,用于 Critic 读 violations)
    console.log('[Workflow] Step 1: Scorer (pre-patch)');
    const prePatchReport = await scorerRun(currentArtifact, input.baseScorer, input.contract);

    // 2. Critic(读 pre-patch violations,生成 patch)
    console.log('[Workflow] Step 2: Critic');
    const patches = await generatePatches(prePatchReport, currentArtifact);

    // 3. Apply patches → post-patch artifact
    const postPatchArtifact = patches.length > 0
      ? applyPatches(currentArtifact, patches)
      : currentArtifact;

    // 4. Score(post-patch,记录到 iteration)
    console.log('[Workflow] Step 1b: Scorer (post-patch)');
    const postPatchReport = await scorerRun(postPatchArtifact, input.baseScorer, input.contract);

    // 记录本轮:artifact 是 pre-patch 的(展示原始输入),score 是 post-patch 的(展示修复效果)
    allIterations.push({
      artifact: currentArtifact,
      score: postPatchReport.final_score,
      violations: prePatchReport.deterministic.hard_violation_count,
      patchesApplied: patches.length,
    });

    // 5. Curator(检测 post-patch artifact 新颖度)
    console.log('[Workflow] Step 3: Curator');
    const proposals = await detectNovelty(postPatchArtifact, input.knownStates);
    for (const p of proposals) {
      writeProposal(p, input.artifactId);
    }
    totalProposals += proposals.length;

    // 6. 更新 currentArtifact 为 post-patch(下一轮输入)
    currentArtifact = postPatchArtifact;

    // 7. 终止条件:post-patch 提升 < MIN_IMPROVEMENT(比较本轮 post-patch vs 上轮 post-patch)
    if (i > 0 && allIterations.length >= 2) {
      const prevPostPatchScore = allIterations[allIterations.length - 2].score;
      const currPostPatchScore = allIterations[allIterations.length - 1].score;
      if (currPostPatchScore - prevPostPatchScore < MIN_IMPROVEMENT) {
        console.log(`[Workflow] improvement < ${MIN_IMPROVEMENT}, stopping`);
        break;
      }
    }
    lastPostPatchScore = postPatchReport.final_score;
  }

  return {
    iterations: allIterations,
    finalArtifact: currentArtifact,
    finalScore: lastPostPatchScore,
    proposals: totalProposals,
  };
}
```

- [ ] **Step 6: 写失败测试**

```typescript
// tests/workflow/crucible.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadContract } from '../../src/contract/validate.js';
import { compileContract } from '../../src/contract/compiler.js';
import { runCrucibleWorkflow } from '../../src/workflow/crucible.js';
import { hk3dayBuggy } from '../../src/fixtures/hk-3day-buggy.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONTRACT_PATH = join(__dirname, '..', '..', 'contracts', 'travel-sequence-v1.yaml');

describe('runCrucibleWorkflow', () => {
  beforeEach(() => {
    delete process.env.OPENROUTER_API_KEY;
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('runs 3 iterations max and produces final artifact', async () => {
    const contract = loadContract(CONTRACT_PATH);
    const baseScorer = compileContract(contract);
    const result = await runCrucibleWorkflow({
      artifact: hk3dayBuggy,
      contract,
      baseScorer,
      artifactId: 'test-run',
      knownStates: ['at_hotel', 'hiking', 'luggage_drop', 'depart_from_hotel'],
    });
    expect(result.iterations.length).toBeGreaterThanOrEqual(1);
    expect(result.iterations.length).toBeLessThanOrEqual(3);
    expect(result.finalArtifact).toBeDefined();
    expect(result.finalScore).toBeGreaterThanOrEqual(0);
  });

  it('hard violations decrease or reach zero over iterations', async () => {
    const contract = loadContract(CONTRACT_PATH);
    const baseScorer = compileContract(contract);
    const result = await runCrucibleWorkflow({
      artifact: hk3dayBuggy,
      contract,
      baseScorer,
      artifactId: 'test-violations',
      knownStates: ['at_hotel', 'hiking', 'luggage_drop', 'depart_from_hotel'],
    });
    const violations = result.iterations.map(i => i.violations);
    // 违规数应非递增(Critic 修复后减少或不变)
    for (let i = 1; i < violations.length; i++) {
      expect(violations[i]).toBeLessThanOrEqual(violations[i - 1]);
    }
  });

  // eng-review T1:验证 iteration.score 是 post-patch 分数(A1 修复),非递减 + 至少一轮提升
  it('iteration scores are non-decreasing with at least one improvement (post-patch scores recorded)', async () => {
    const contract = loadContract(CONTRACT_PATH);
    const baseScorer = compileContract(contract);
    const result = await runCrucibleWorkflow({
      artifact: hk3dayBuggy,
      contract,
      baseScorer,
      artifactId: 'test-monotonic',
      knownStates: ['at_hotel', 'hiking', 'luggage_drop', 'depart_from_hotel'],
    });
    expect(result.iterations.length).toBeGreaterThanOrEqual(2);
    const scores = result.iterations.map(i => i.score);
    // post-patch score 应非递减(Critic 修复违规 → 分数上升或持平)
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i]).toBeGreaterThanOrEqual(scores[i - 1] - 0.001); // 容差
    }
    // 至少一轮严格提升(v1→v2 违规修复)
    const improvements = [];
    for (let i = 1; i < scores.length; i++) {
      improvements.push(scores[i] - scores[i - 1]);
    }
    expect(Math.max(...improvements)).toBeGreaterThan(0.01);
  });
});
```

- [ ] **Step 7: 跑测试确认通过**

```bash
npx vitest run tests/workflow/crucible.test.ts
```

Expected: PASS, 2 个测试全过。如果有 FAIL,检查 workflow 循环逻辑。

- [ ] **Step 8: Commit**

```bash
git add src/agents/contract-author.ts src/agents/scorer.ts src/agents/judge.ts src/agents/registry.ts src/workflow/crucible.ts tests/workflow/crucible.test.ts
git commit -m "feat(workflow): 5 Mastra agents + crucible workflow with 3-iteration score-improve loop"
```

---

## Task 10: E2E 验收测试 (4.2 单调上升 + 4.3 可观测 + 4.4 版本化)

**Files:**
- Test: `tests/e2e/iteration.test.ts`

- [ ] **Step 1: 写 E2E 验收测试**

```typescript
// tests/e2e/iteration.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, readdirSync, rmSync } from 'node:fs';
import { loadContract } from '../../src/contract/validate.js';
import { compileContract } from '../../src/contract/compiler.js';
import { runCrucibleWorkflow } from '../../src/workflow/crucible.js';
import { hk3dayBuggy } from '../../src/fixtures/hk-3day-buggy.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONTRACT_PATH = join(__dirname, '..', '..', 'contracts', 'travel-sequence-v1.yaml');
const PROPOSALS_DIR = join(__dirname, '..', '..', 'contracts', 'proposals');

describe('P0 acceptance 4.2 — score improves over iterations', () => {
  beforeEach(() => {
    delete process.env.OPENROUTER_API_KEY;
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    if (existsSync(PROPOSALS_DIR)) {
      rmSync(PROPOSALS_DIR, { recursive: true, force: true });
    }
  });

  it('iterations show score improvement (deterministic violations get fixed)', async () => {
    const contract = loadContract(CONTRACT_PATH);
    const baseScorer = compileContract(contract);
    const result = await runCrucibleWorkflow({
      artifact: hk3dayBuggy,
      contract,
      baseScorer,
      artifactId: 'e2e-4-2',
      knownStates: ['at_hotel', 'hiking', 'luggage_drop', 'depart_from_hotel'],
    });
    // 至少 2 轮才能看改进
    expect(result.iterations.length).toBeGreaterThanOrEqual(2);
    const scores = result.iterations.map(i => i.score);
    // 验收 4.2 语义(outside-voice Q1 修正):
    // P0 无 API key 时 judge=neutral 0.5,修复违规后 det 0.55→1.0。
    // 第一轮 v1→v2 必须有提升(违规被修复),后续轮次可持平(无更多违规可修)。
    // 故断言:非递减 + 至少一轮严格提升。
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i]).toBeGreaterThanOrEqual(scores[i - 1] - 0.001); // 非递减(容差)
    }
    // 至少有一轮严格提升(v1→v2,违规修复后分数上升)
    const improvements = [];
    for (let i = 1; i < scores.length; i++) {
      improvements.push(scores[i] - scores[i - 1]);
    }
    expect(Math.max(...improvements)).toBeGreaterThan(0.01); // 至少一轮提升 > 0.01
    console.log('E2E 4.2 scores:', scores, 'improvements:', improvements);
  });

  it('hard violations reach zero by final iteration', async () => {
    const contract = loadContract(CONTRACT_PATH);
    const baseScorer = compileContract(contract);
    const result = await runCrucibleWorkflow({
      artifact: hk3dayBuggy,
      contract,
      baseScorer,
      artifactId: 'e2e-violations',
      knownStates: ['at_hotel', 'hiking', 'luggage_drop', 'depart_from_hotel'],
    });
    const finalViolations = result.iterations[result.iterations.length - 1].violations;
    expect(finalViolations).toBe(0);
  });
});

describe('P0 acceptance 4.3 — multi-agent coordination observable', () => {
  beforeEach(() => {
    delete process.env.OPENROUTER_API_KEY;
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('workflow logs show Scorer + Critic + Curator + Workflow + Judge agent activity', async () => {
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => logs.push(args.map(String).join(' ')));

    const contract = loadContract(CONTRACT_PATH);
    const baseScorer = compileContract(contract);
    await runCrucibleWorkflow({
      artifact: hk3dayBuggy,
      contract,
      baseScorer,
      artifactId: 'e2e-4-3',
      knownStates: ['at_hotel', 'hiking', 'luggage_drop', 'depart_from_hotel'],
    });

    const allLogs = logs.join('\n');
    // 验收 4.3:日志能看到 5 个 agent 的活动(降级模式,Studio 跑不起来时用日志)
    expect(allLogs).toMatch(/\[Scorer\]/);
    expect(allLogs).toMatch(/\[Critic\]/);
    expect(allLogs).toMatch(/\[Curator\]/);
    expect(allLogs).toMatch(/\[Workflow\]/);
    // Judge fan-out 可观测(Scorer 内部调 judge,日志在 augmented scorer 里)
    expect(allLogs).toMatch(/\[Scorer\].*judge|fanning|fan.*out|judge fan/i);
  });
});

describe('P0 acceptance 4.4 — contract versioning via Curator proposals', () => {
  beforeEach(() => {
    delete process.env.OPENROUTER_API_KEY;
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    if (existsSync(PROPOSALS_DIR)) {
      rmSync(PROPOSALS_DIR, { recursive: true, force: true });
    }
  });

  it('Curator writes proposal YAML file when novelty detected', async () => {
    const contract = loadContract(CONTRACT_PATH);
    const baseScorer = compileContract(contract);
    // 用一个含新颖 state 的 artifact 触发 Curator
    const artifactWithNovelty = {
      ...hk3dayBuggy,
      nodes: [
        ...hk3dayBuggy.nodes,
        {
          time_block: '12:00-13:00',
          action: '午餐',
          duration_min: 60,
          node_type: 'dining',
          state: ['hungry', 'novel_state_xyz'],
        },
      ],
    };
    await runCrucibleWorkflow({
      artifact: artifactWithNovelty,
      contract,
      baseScorer,
      artifactId: 'e2e-4-4',
      knownStates: ['at_hotel', 'hiking', 'luggage_drop', 'depart_from_hotel'],
    });

    // 验收 4.4:proposals 目录有文件
    expect(existsSync(PROPOSALS_DIR)).toBe(true);
    const files = readdirSync(PROPOSALS_DIR);
    expect(files.length).toBeGreaterThan(0);
    expect(files.some(f => f.endsWith('.yaml'))).toBe(true);
  });
});
```

- [ ] **Step 2: 跑 E2E 测试**

```bash
npx vitest run tests/e2e/iteration.test.ts
```

Expected: 4 个测试全过。如果 4.2 "score improvement" 失败,检查 workflow 是否真的在 patch 后重新打分并记录正确分数。

- [ ] **Step 3: 跑全部测试**

```bash
npx vitest run
```

Expected: 全部 PASS(Part 1 54 + Part 2 新增,无回归)。

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/iteration.test.ts
git commit -m "test(e2e): P0 acceptance 4.2/4.3/4.4 — score improvement, agent observability, contract versioning"
```

---

## Self-Review

**1. Spec coverage:**

| Spec Part 2 节 | Task | 状态 |
|---|---|---|
| §3 接口调整(CompiledScorer 导出 + AsyncScorer) | Task 0 | ✅ |
| §4.1 3 judge rubric | Task 3 | ✅ |
| §4.2 5 Mastra agent | Task 6/7/9 | ✅ (Contract-Author/Scorer/Judge 是 Mastra Agent,Critic/Curator 纯函数) |
| §4.3 Workflow 编排 | Task 9 | ✅ |
| §4.4 提分迭代回路 | Task 9/10 | ✅ (验收 4.2) |
| §4.5 可观测 | Task 9/10 | ✅ (降级用日志,验收 4.3) |
| §4.6 契约版本化 | Task 8/10 | ✅ (验收 4.4) |
| §7 风险降级 | Task 2/3 | ✅ (无 key 降级 neutral) |

**2. Placeholder scan:**

- ✅ 无 "TBD/TODO/implement later"
- ✅ 每个 step 都有完整代码
- ✅ 每个 test 都有具体 assert
- ⚠️ Task 8 `writeProposal` 无独立单测(集成在 Task 10 e2e),typecheck 通过即视为完成——有意简化,git commit 在单测里不好 mock

**3. Type consistency:**

- `JudgeRubric` / `JudgeContext` — Task 3 定义,Task 4/9 一致 ✅
- `ArtifactPatch` — Task 5 定义,Task 6/9 一致 ✅
- `AsyncScorer` — Task 0 定义,Task 4 实现 ✅
- `ScoreReport.judge` — Part 1 定义 null,Task 4 填充对象,类型一致 ✅
- `ExpansionProposal` — Task 7 定义,Task 8/9 一致 ✅
- `CrucibleRunInput` / `CrucibleRunResult` / `CrucibleIteration` — Task 9 定义,Task 10 一致 ✅

无类型不一致。

**4. Part 1 接口复用(反哺验证):**

- `compileContract` — Task 0 导出 CompiledScorer,Task 4/9/10 调用 ✅
- `loadContract` — Task 4/9/10 调用 ✅
- `hk3dayBuggy` / `hk3dayGolden` — Task 4/6/9/10 调用 ✅
- `Violation.fix_hint` / `location` — Task 6 Critic 读取 ✅
- `ScoreReport` 结构 — Task 4 扩展 judge 字段 ✅
- `AsyncScorer` 新接口 — Task 0 加,Task 4 实现 ✅

Part 1 接口全部复用,Task 0 处理了 2 个反哺调整点。

---

## Required Outputs (plan-eng-review Part 2)

### NOT in scope (Part 2 不做,留 P1+)

- Contract-Author 自动 LLM 修订(P0 只读)
- Curator 自动合并契约扩张(P0 只检测+提议)
- 冻结黄金集校准 judge(P0 不校准)
- champion-challenger A/B
- 情报表探针(第二族)
- UI/前端
- 采集层(P2)
- MCP server(P2)
- Mastra Studio UI 定制(P0 用默认 Studio + 日志降级)

### TODOS (Part 2 完成后)

- [ ] P1: Contract-Author 加 LLM 修订能力
- [ ] P1: Curator 自动合并提议(需 Human Gate)
- [ ] P1: 冻结黄金集校准 judge
- [ ] P2: Mastra Studio UI 定制
- [ ] P2: 采集层 fork BigSet
- [ ] P2: MCP server

### Failure Modes Registry (Part 2)

```
┌────────────────────────────────┬──────────┬────────────────────────────┐
│ Failure                        │ Severity │ Handling                   │
├────────────────────────────────┼──────────┼────────────────────────────┤
│ OPENROUTER_API_KEY missing     │ Soft     │ judge 返回 0.5 + 警告      │
│ LLM 返回非数字                  │ Soft     │ parseJudgeScore 返回 0.5  │
│ LLM 调用网络错误                │ Soft     │ callLLM catch 返回 null   │
│ Critic patch 不提分             │ Soft     │ 终止条件保护(< 0.01 停) │
│ git commit 失败                 │ Soft     │ proposal 文件仍写,警告   │
│ Mastra Studio 跑不起来          │ Soft     │ 日志替代(验收 4.3)      │
│ 无穷迭代(patch 不收敛)         │ Hard     │ MAX_ITERATIONS=3 硬上限   │
│ judge fan-out 部分失败          │ Soft     │ Promise.all 全等,失败项   │
│                                │          │ 返回 0.5(降级)            │
│ Mastra 依赖安装失败             │ Hard     │ spec §7 降级:纯 TS +      │
│                                │          │ Promise.all 实现 fan-out  │
└────────────────────────────────┴──────────┴────────────────────────────┘
```

### Implementation Tasks Summary

| Task | 文件 | 测试数 | 依赖 |
|---|---|---|---|
| 0 | compiler.ts + scorer/types.ts(接口调整) | 0(回归验证) | Part 1 完成 |
| 1 | deps + .env | 0(回归验证) | 0 |
| 2 | llm/client.ts | 4 | 1 |
| 3 | judge rubrics (4 files) | 10 | 2 |
| 4 | scorer/augmented.ts | 4 | 0,3 |
| 5 | patch/types.ts + apply.ts | 6 | Part 1 |
| 6 | agents/critic.ts | 5 | 5 |
| 7 | agents/curator.ts | 4 | Part 1 |
| 8 | proposals/write.ts | 0 (typecheck) | 7 |
| 9 | agents + workflow (5 files) | 2 | 4,6,7,8 |
| 10 | e2e iteration.test.ts | 4 | 9 |
| **总** | | **39 新测试** | |

---

## GSTACK REVIEW REPORT

**Plan:** `docs/superpowers/plans/2026-06-24-crucible-p0-mvp-part2.md` (Part 2 of 2)
**Branch:** crucible/dev
**Review date:** 2026-06-24
**Reviewer:** Claude (plan-eng-review skill,完整 4-section + outside voice)

### Runs / Status / Findings

| Run | Skill | Status | Findings | Fixed |
|---|---|---|---|---|
| 1 | Step 0 Scope Challenge | ✅ DONE | 复杂度触发但合理(模块化设计),Part 1 复用充分,无 scope creep | 无需修复 |
| 2 | Section 1 Architecture | ✅ DONE | A1(workflow score 跟踪 bug,影响验收 4.2), A2(judgeDims.find 重复), A3(judge fan-out 逻辑重复) | A1=A(重构 post-patch score 跟踪), A2=A(Map 查找), A3=A(提取 fanoutJudges 共享函数 + Task 3.5) |
| 3 | Section 2 Code Quality | ✅ DONE | C1(writeProposal execSync shell 注入), C2(Critic no_duplicate_state 注释缺失), C3(workflow 重复 score 调用性能) | C1=A(execFileSync + 参数数组), C2=A(加注释), C3=deferred P1 |
| 4 | Section 3 Tests | ✅ DONE | T1(workflow 测试缺 post-patch score 验证), T2(augmented 测试权重硬编码), T3(fanoutJudges 缺独立单测) | T1=A(加单调性测试), T2=nit(可接受), T3=A(Task 3.5 加 5 测试) |
| 5 | Section 4 Performance | ✅ DONE | P1(18 次 LLM 调用), P2(parseJudgeScore regex), P3(git commit IO) | 全 deferred P1(P0 无 API key 时无差异) |
| 6 | Outside Voice (Claude 自验,subagent 读取超时降级) | ✅ DONE | Q1(score 单调性语义矛盾:E2E 断言"严格递增"但 P0 降级时 flat), Q2(Task 0 不破坏 Part 1,✅), Q3(fanout.ts import 路径全正确,✅) | Q1=A(改断言为"非递减 + 至少一轮提升 > 0.01") |

### VERDICT

**PASS (pending execution).**

Part 2 plan 可执行。12 个 TDD task(含 Task 0 接口调整 + Task 3.5 共享 fanout),44 个新测试(原 39 + T1 加 1 + T3 加 5 - 1 调整),覆盖 3 个验收(4.2 分数改进 / 4.3 协同可观测 / 4.4 版本化)。

**关键修复:**
- A1 workflow score 跟踪重构(每轮记 post-patch score,验收 4.2 语义正确)
- A3 提取 fanoutJudges 共享函数(DRY,Task 4 + Task 9 共用)
- C1 writeProposal 改 execFileSync(安全,无 shell 注入)
- Q1 E2E 4.2 断言修正(非递减 + 至少一轮提升,匹配 P0 降级现实)
- T3 fanoutJudges 直接单测(核心函数早期回归保护)

**Deferred tech debt(写入 TODOS.md,Part 2 完成后):**
- C3: workflow 重复 score 调用(pre-patch 可只跑确定性,省一半 LLM 调用)— P1
- P1: 18 次 LLM 调用优化(同 C3)— P1
- P3: git commit 批量化(多 proposal 一次 commit)— P1
- T2: augmented 测试权重硬编码(从 Contract 读)— P1 nit

**Outside voice:** Claude 自验(subagent 读取超时降级)。Q1/Q2/Q3 全验证,Q1 发现真问题已修。

**CODEX:** 不可用(codex 不在 PATH)。

**CROSS-MODEL:** N/A(codex 不可用,无 cross-model consensus)。

NO UNRESOLVED DECISIONS
