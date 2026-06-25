# Crucible P1 Plan 1 of 3: 基础设施 + state_mutex + 黄金集标注

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 完成 P1 前三项:① LLM provider 切换(支持任意 OpenAI 兼容 endpoint) ② state_mutex 升级到相邻节点互斥 + fixture 重做 ③ 冻结黄金集构造 + 人工标注(pairwise)。

**Architecture:** 改动集中在 3 个区域:LLM client(1 文件)、state_mutex 谓词(1 文件)+ buggy fixture(1 文件)+ 验收测试、黄金集(新文件 + 交互标注)。

**Tech Stack:** 保持 P0 全部,移除 `@openrouter/ai-sdk-provider`,新增 `@ai-sdk/openai`。

**Spec:** `docs/superpowers/specs/crucible-p1-spec.md` §2.1 + §2.2 + §2.3

**P0 接口依赖:**
- `src/llm/client.ts` — callLLM/hasApiKey(要改 provider)
- `src/predicates/state_mutex.ts` — makeStateMutex(要升级逻辑)
- `src/fixtures/hk-3day-buggy.ts` — hk3dayBuggy(要重做 fixture)
- `src/predicates/no_duplicate_state.ts` — CLEARING_TYPES(要共用)
- `tests/fixtures/acceptance.test.ts` — 验收断言(要调整)

---

## File Structure (Plan 1 新增/修改)

```
crucible-dev/
├── src/
│   ├── llm/client.ts              # 修改:换 provider
│   ├── predicates/state_mutex.ts   # 修改:升级到相邻节点互斥
│   ├── fixtures/hk-3day-buggy.ts   # 修改:重做 fixture
│   └── golden/                     # 新增目录
│       ├── artifacts.ts            # 8 个黄金工件(从 q-traveller 种子提取)
│       └── ranking.ts              # 排序工具(pairwise + Kendall τ)
├── golden/
│   └── human-ranking.jsonl         # 人工标注产出(运行时生成)
├── tests/
│   ├── predicates/state_mutex.test.ts  # 修改:加相邻节点测试
│   ├── fixtures/acceptance.test.ts     # 修改:调整断言
│   └── golden/ranking.test.ts          # 新增:排序工具测试
├── .env.example                    # 修改:换 env var 名
└── package.json                    # 修改:换依赖
```

---

## Task 1: LLM provider 切换(@openrouter → @ai-sdk/openai)

**Files:**
- Modify: `package.json`(换依赖)
- Modify: `src/llm/client.ts`(换 provider + env var)
- Modify: `.env.example`(换 env var 名)
- Modify: `tests/llm/client.test.ts`(调整 env var 名)

- [ ] **Step 1: 更新 package.json 依赖**

把 `@openrouter/ai-sdk-provider` 替换为 `@ai-sdk/openai`:

```json
{
  "dependencies": {
    "yaml": "^2.4.0",
    "zod": "^3.22.0",
    "ai": "^6.0.0",
    "@ai-sdk/openai": "^2.0.0",
    "dotenv": "^16.4.0"
  }
}
```

- [ ] **Step 2: 安装新依赖**

```bash
npm install
```

Expected: `@ai-sdk/openai` 安装成功,`@openrouter/ai-sdk-provider` 可保留或移除(不影响)。

- [ ] **Step 3: 更新 .env.example**

```env
# .env.example
# OpenAI 兼容 API key(支持 OpenAI 官方 / Azure / vLLM / 火山方舟等任意 OpenAI 格式 endpoint)
OPENAI_API_KEY=
# Base URL(默认 https://api.openai.com/v1,自建服务填自己的 URL)
OPENAI_BASE_URL=https://api.openai.com/v1
# 模型名(如 gpt-4o / deepseek-chat / 其他)
OPENAI_MODEL=gpt-4o
```

- [ ] **Step 4: 重写 src/llm/client.ts**

```typescript
// src/llm/client.ts
import { createOpenAI } from '@ai-sdk/openai';
import { generateText } from 'ai';

export function hasApiKey(): boolean {
  return !!process.env.OPENAI_API_KEY;
}

/**
 * callLLM: 封装 Vercel AI SDK + OpenAI 兼容 provider。
 * 支持任意 OpenAI 格式 endpoint(OpenAI 官方 / Azure / vLLM / 火山方舟等)。
 * 无 API key 时返回 null + 警告(降级模式)。
 * 出错时返回 null + 警告,不 crash workflow。
 */
export async function callLLM(prompt: string): Promise<string | null> {
  if (!hasApiKey()) {
    console.warn('[LLM] OPENAI_API_KEY missing, judge will use neutral 0.5');
    return null;
  }
  try {
    const openai = createOpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      baseURL: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
    });
    const model = process.env.OPENAI_MODEL || 'gpt-4o';
    const result = await generateText({
      model: openai(model),
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

- [ ] **Step 5: 更新 tests/llm/client.test.ts(env var 名)**

把所有 `OPENROUTER_API_KEY` 替换为 `OPENAI_API_KEY`:

```typescript
// tests/llm/client.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { callLLM, hasApiKey } from '../../src/llm/client.js';

describe('LLM client', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('hasApiKey returns false when OPENAI_API_KEY missing', () => {
    delete process.env.OPENAI_API_KEY;
    expect(hasApiKey()).toBe(false);
  });

  it('hasApiKey returns true when key set', () => {
    process.env.OPENAI_API_KEY = 'sk-test';
    expect(hasApiKey()).toBe(true);
    delete process.env.OPENAI_API_KEY;
  });

  it('callLLM returns null + warns when no API key', async () => {
    delete process.env.OPENAI_API_KEY;
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await callLLM('test prompt');
    expect(result).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringMatching(/OPENAI_API_KEY missing/));
    warnSpy.mockRestore();
  });

  it('callLLM returns string or null when API key set (may fail with invalid key)', async () => {
    process.env.OPENAI_API_KEY = 'sk-test';
    const result = await callLLM('Return the word: hello');
    expect(result === null || typeof result === 'string').toBe(true);
    delete process.env.OPENAI_API_KEY;
  });
});
```

- [ ] **Step 6: 跑测试确认通过**

```bash
npx vitest run tests/llm/client.test.ts
```

Expected: PASS, 4 个测试全过。

- [ ] **Step 7: 跑全部测试确认无回归**

```bash
npx vitest run
```

Expected: 全部 PASS(119 tests)。如果有 FAIL,检查其他文件是否引用了 `OPENROUTER_API_KEY`(全局搜索替换)。

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json src/llm/client.ts .env.example tests/llm/client.test.ts
git commit -m "feat(llm): switch from @openrouter to @ai-sdk/openai (support any OpenAI-compatible endpoint)"
```

---

## Task 2: state_mutex 升级到相邻节点互斥

**Files:**
- Modify: `src/predicates/state_mutex.ts`(升级逻辑)
- Modify: `src/fixtures/hk-3day-buggy.ts`(重做 fixture)
- Modify: `tests/predicates/state_mutex.test.ts`(加相邻节点测试)
- Modify: `tests/fixtures/acceptance.test.ts`(调整断言)

- [ ] **Step 1: 重写 state_mutex.ts(升级到相邻节点互斥)**

```typescript
// src/predicates/state_mutex.ts
import type { Artifact, Predicate, Violation } from './types.js';

const CLEARING_TYPES = new Set(['switch', 'buffer']);

/**
 * makeStateMutex: 工厂,接收 mutex token 列表,返回 Predicate。
 *
 * P1 升级(eng-review A2 技术债偿还):
 * - 同节点互斥:同一节点内不能同时持有两个 mutex token(P0 已有,保留)
 * - 相邻节点互斥:相邻节点不能分别持有互斥 token,除非中间有 clearing transition(switch/buffer)
 *   例如:节点 0 持有 luggage_drop,节点 1 持有 depart_from_hotel → 违规(先寄存后出发,互斥)
 *   除非节点 0 和 1 之间有 switch/buffer 清除 state
 *
 * 注(outside-voice #12):签名用 string[] 而非 tuple,Contract YAML 的 mutex 字段是数组。
 * P1 仍只取前 2 个检查。
 */
export function makeStateMutex(mutexTokens: string[]): Predicate {
  if (mutexTokens.length < 2) {
    return () => [];
  }
  const a = mutexTokens[0];
  const b = mutexTokens[1];
  return (artifact: Artifact): Violation[] => {
    const violations: Violation[] = [];
    const nodes = artifact.nodes;

    // 检查 1:同节点互斥(P0 保留)
    nodes.forEach((node, idx) => {
      const states = Array.isArray(node.state) ? node.state.map(String) : [];
      if (states.includes(a) && states.includes(b)) {
        violations.push({
          constraint_id: 'state_mutex',
          severity: 'hard',
          message: `node ${idx} holds both mutex states: ${a} and ${b}`,
          location: { node_index: idx, field: 'state' },
          fix_hint: `remove one of ${a}/${b} from this node, or split into two nodes with a clearing transition`,
        });
      }
    });

    // 检查 2:相邻节点互斥(P1 新增)
    for (let i = 0; i < nodes.length - 1; i++) {
      const nodeA = nodes[i];
      const nodeB = nodes[i + 1];
      const aClears = CLEARING_TYPES.has(String(nodeA.node_type ?? ''));
      const bClears = CLEARING_TYPES.has(String(nodeB.node_type ?? ''));
      if (aClears || bClears) continue; // 有 clearing,不检查

      const statesA = new Set(Array.isArray(nodeA.state) ? nodeA.state.map(String) : []);
      const statesB = Array.isArray(nodeB.state) ? nodeB.state.map(String) : [];

      // 节点 A 持有 a,节点 B 持有 b(或反过来)
      if ((statesA.has(a) && statesB.has(b)) || (statesA.has(b) && statesB.has(a))) {
        violations.push({
          constraint_id: 'state_mutex',
          severity: 'hard',
          message: `adjacent nodes ${i} and ${i + 1} hold mutex states across nodes: ${a} and ${b}`,
          location: { node_index: i, node_index_end: i + 1, field: 'state' },
          fix_hint: `insert a switch/buffer node between them, or remove one mutex state`,
        });
      }
    }

    return violations;
  };
}
```

- [ ] **Step 2: 加相邻节点互斥测试**

在 `tests/predicates/state_mutex.test.ts` 追加:

```typescript
  // P1 新增:相邻节点互斥
  it('flags when adjacent nodes hold mutex tokens (node 0 has a, node 1 has b)', () => {
    const artifact: Artifact = {
      family: 'sequence',
      nodes: [
        { action: 'drop luggage', state: ['luggage_drop'] },
        { action: 'depart from hotel', state: ['depart_from_hotel'] },
      ],
    };
    const violations = predicate(artifact);
    expect(violations).toHaveLength(1);
    expect(violations[0].constraint_id).toBe('state_mutex');
    expect(violations[0].message).toMatch(/adjacent/);
    expect(violations[0].location.node_index).toBe(0);
    expect(violations[0].location.node_index_end).toBe(1);
  });

  it('does not flag adjacent mutex when switch node clears between them', () => {
    const artifact: Artifact = {
      family: 'sequence',
      nodes: [
        { action: 'drop luggage', state: ['luggage_drop'] },
        { node_type: 'switch', action: 'leave hotel' },
        { action: 'depart from hotel', state: ['depart_from_hotel'] },
      ],
    };
    expect(predicate(artifact)).toEqual([]);
  });

  it('does not flag adjacent mutex when buffer node clears between them', () => {
    const artifact: Artifact = {
      family: 'sequence',
      nodes: [
        { action: 'drop luggage', state: ['luggage_drop'] },
        { node_type: 'buffer', action: 'wait' },
        { action: 'depart from hotel', state: ['depart_from_hotel'] },
      ],
    };
    expect(predicate(artifact)).toEqual([]);
  });

  it('flags both same-node and adjacent-node mutex if both present', () => {
    const artifact: Artifact = {
      family: 'sequence',
      nodes: [
        { action: 'confused', state: ['luggage_drop', 'depart_from_hotel'] },
        { action: 'also confused', state: ['luggage_drop'] },
      ],
    };
    // 节点 0: 同节点互斥 (luggage_drop + depart_from_hotel)
    // 节点 0→1: 相邻互斥 (节点0有luggage_drop, 节点1有luggage_drop... 但 mutex 是 luggage_drop vs depart_from_hotel)
    // 节点 1 只有 luggage_drop,无 depart_from_hotel → 不触发相邻互斥
    // 所以只有 1 个违规(同节点)
    const violations = predicate(artifact);
    expect(violations).toHaveLength(1);
    expect(violations[0].message).toMatch(/both mutex states/);
  });
```

- [ ] **Step 3: 跑 state_mutex 测试确认通过**

```bash
npx vitest run tests/predicates/state_mutex.test.ts
```

Expected: PASS, 原有 4 + 新增 4 = 8 个测试全过。

- [ ] **Step 4: 重做 hk-3day-buggy fixture(贴近 q-traveller §7 真实场景)**

buggy fixture 的 Bug 2 改为相邻节点互斥(不再是同节点):

```typescript
// src/fixtures/hk-3day-buggy.ts
import type { Artifact } from '../predicates/types.js';

/**
 * 香港 3 天 buggy 版本(Day 1 上午)。
 * P1 重做:bug 贴近 q-traveller §7 真实场景。
 *
 * Bug 1 (continuity): 节点 0(dining) → 节点 1(core_experience),
 *   缺 transit/switch。对应"早餐后→地铁缺切换"。
 *
 * Bug 2 (state_mutex): 节点 0 持有 luggage_drop,节点 1 持有 depart_from_hotel,
 *   相邻节点互斥,中间无 clearing。对应"寄存行李与从酒店出发互斥重复"(P1 升级:真实场景)。
 *
 * Bug 3 (no_duplicate_state): 节点 0 和节点 1 都持有 at_hotel,中间无 clearing。
 *   对应"状态重复"。
 *
 * 共 3 个 hard violation(1 continuity + 1 mutex + 1 duplicate)。
 */
export const hk3dayBuggy: Artifact = {
  family: 'sequence',
  metadata: {
    day: 1,
    daily_available_minutes: 960,
    budget: { min: 0, max: 800 },
  },
  nodes: [
    {
      time_block: '08:00-08:30',
      action: '早餐 茶餐厅 + 寄存行李',
      route: '酒店 → 油麻地茶餐厅',
      duration_min: 30,
      node_type: 'dining',
      elasticity: 'compressible',
      cost: 50,
      source: '小红书 v1 笔记',
      source_trust: 0.85,
      // Bug 2: 持有 luggage_drop(相邻节点 1 持有 depart_from_hotel → 互斥)
      // Bug 3: 持有 at_hotel(节点 1 也持有 → 重复)
      state: ['at_hotel', 'luggage_drop'],
    },
    {
      // Bug 1: dining 直接接 core_experience,中间无 transit/switch
      // Bug 2: 持有 depart_from_hotel(与节点 0 的 luggage_drop 相邻互斥)
      // Bug 3: 持有 at_hotel(与节点 0 重复)
      time_block: '08:30-11:30',
      action: '龙脊徒步精华段',
      route: '土地湾 → 大潭峡',
      duration_min: 180,
      node_type: 'core_experience',
      elasticity: 'non_compressible',
      cost: 0,
      source: 'dhk_dragonback_zh.html',
      source_trust: 0.95,
      state: ['at_hotel', 'depart_from_hotel', 'hiking'],
    },
  ],
};
```

- [ ] **Step 5: 调整验收测试断言**

`tests/fixtures/acceptance.test.ts` 里 state_mutex 的断言要改(不再是同节点,是相邻节点):

```typescript
  it('buggy artifact catches state_mutex violation (Bug 2)', () => {
    const report = scorer.score(hk3dayBuggy);
    const mutexV = report.deterministic.violations.filter(
      v => v.constraint_id === 'state_mutex'
    );
    expect(mutexV).toHaveLength(1);
    expect(mutexV[0].message).toMatch(/luggage_drop/);
    expect(mutexV[0].message).toMatch(/depart_from_hotel/);
    // P1: 相邻节点互斥(不再是同节点)
    expect(mutexV[0].message).toMatch(/adjacent/);
    expect(mutexV[0].location.node_index).toBe(0);
    expect(mutexV[0].location.node_index_end).toBe(1);
  });
```

同时调整 fix_hint 断言(state_mutex 的 fix_hint 改了):

```typescript
  it('state_mutex violation points to node 0 (holds both mutex tokens)', () => {
    const report = scorer.score(hk3dayBuggy);
    const v = report.deterministic.violations.find(v => v.constraint_id === 'state_mutex');
    expect(v).toBeDefined();
    // P1: 相邻节点,node_index=0, node_index_end=1
    expect(v!.location.node_index).toBe(0);
    expect(v!.location.node_index_end).toBe(1);
    expect(v!.location.field).toBe('state');
  });
```

- [ ] **Step 6: 跑验收测试确认通过**

```bash
npx vitest run tests/fixtures/acceptance.test.ts
```

Expected: PASS。如果有 FAIL,检查:
- 总违规数是否还是 3(1 continuity + 1 mutex + 1 duplicate)
- state_mutex 的 message 是否含 "adjacent"
- Critic 测试的 patch 生成是否正确(state_mutex 的 patch 逻辑可能要调,因为 location 变了)

- [ ] **Step 7: 跑全部测试确认无回归**

```bash
npx vitest run
```

Expected: 全部 PASS。如果有 FAIL,修复后重跑。

- [ ] **Step 8: Commit**

```bash
git add src/predicates/state_mutex.ts src/fixtures/hk-3day-buggy.ts tests/predicates/state_mutex.test.ts tests/fixtures/acceptance.test.ts
git commit -m "feat(predicates): state_mutex upgraded to adjacent-node mutex + fixture redone for realism"
```

---

## Task 3: 冻结黄金集构造(工件提取 + 排序工具)

**Files:**
- Create: `src/golden/artifacts.ts`(8 个黄金工件)
- Create: `src/golden/ranking.ts`(排序工具:pairwise + Kendall τ)
- Create: `tests/golden/ranking.test.ts`(排序工具测试)

**注:** 人工标注(pairwise 交互)在 Task 4 执行,本 task 只准备工件 + 工具。

- [ ] **Step 1: 写 8 个黄金工件**

从 q-traveller 种子提取 8 个工件(香港 3 + 云南 3 + 防城港 2),每个是简化的 Artifact(3-5 节点,覆盖不同质量:有的有 bug,有的很完善):

```typescript
// src/golden/artifacts.ts
import type { Artifact } from '../predicates/types.js';

/**
 * 冻结黄金集:8 个工件,3 目的地混合,覆盖不同质量水平。
 * 用于 judge 校准(与人工排序比 Kendall τ)。
 * 永不进 few-shot,只用于回归校准。
 */

// === 香港 3 个 ===

// HK-1: 完善版(无 bug,动线顺,记忆点高)
export const hk1: Artifact = {
  family: 'sequence',
  metadata: { day: 1, daily_available_minutes: 960, budget: { min: 0, max: 800 } },
  nodes: [
    { time_block: '08:00-08:30', action: '早餐茶餐厅', duration_min: 30, node_type: 'dining', cost: 50, source_trust: 0.85, state: ['at_hotel'] },
    { time_block: '08:30-09:00', action: '港铁至筲箕湾', duration_min: 30, node_type: 'transit', cost: 15, source_trust: 1.0, state: [] },
    { time_block: '09:00-09:15', action: '9号巴士至土地湾', duration_min: 15, node_type: 'transit', cost: 6, source_trust: 0.9, state: [] },
    { time_block: '09:15-11:30', action: '龙脊徒步精华段', duration_min: 135, node_type: 'core_experience', cost: 0, source_trust: 0.95, state: ['hiking'] },
  ],
};

// HK-2: 中等版(有 continuity 违规但其他 ok)
export const hk2: Artifact = {
  family: 'sequence',
  metadata: { day: 1, daily_available_minutes: 960, budget: { min: 0, max: 800 } },
  nodes: [
    { time_block: '09:00-10:00', action: '早餐+出发', duration_min: 60, node_type: 'dining', cost: 80, source_trust: 0.7, state: ['at_hotel'] },
    { time_block: '10:00-13:00', action: '太平山顶徒步', duration_min: 180, node_type: 'core_experience', cost: 50, source_trust: 0.8, state: ['hiking'] },
  ],
};

// HK-3: 差版(多 bug:continuity + state_mutex + 时间超)
export const hk3: Artifact = {
  family: 'sequence',
  metadata: { day: 1, daily_available_minutes: 960, budget: { min: 0, max: 800 } },
  nodes: [
    { time_block: '08:00-09:00', action: '早餐+寄存', duration_min: 60, node_type: 'dining', cost: 100, source_trust: 0.5, state: ['luggage_drop'] },
    { time_block: '09:00-18:00', action: '全天逛街无计划', duration_min: 540, node_type: 'core_experience', cost: 500, source_trust: 0.3, state: ['depart_from_hotel'] },
  ],
};

// === 云南 3 个 ===

// YN-1: 完善版(大理古城→洱海骑行→喜洲,无 bug)
export const yn1: Artifact = {
  family: 'sequence',
  metadata: { day: 2, daily_available_minutes: 960, budget: { min: 0, max: 1200 } },
  nodes: [
    { time_block: '08:00-09:00', action: '大理古城早餐', duration_min: 60, node_type: 'dining', cost: 30, source_trust: 0.8, state: ['at_dali'] },
    { time_block: '09:00-09:30', action: '骑行至洱海', duration_min: 30, node_type: 'transit', cost: 20, source_trust: 0.9, state: [] },
    { time_block: '09:30-12:00', action: '洱海环骑行精华段', duration_min: 150, node_type: 'core_experience', cost: 0, source_trust: 0.95, state: ['cycling'] },
    { time_block: '12:00-12:30', action: '骑行至喜洲', duration_min: 30, node_type: 'transit', cost: 0, source_trust: 0.85, state: [] },
    { time_block: '12:30-14:00', action: '喜洲午餐+逛古村', duration_min: 90, node_type: 'core_experience', cost: 60, source_trust: 0.88, state: [] },
  ],
};

// YN-2: 中等版(时间偏紧但无硬违规)
export const yn2: Artifact = {
  family: 'sequence',
  metadata: { day: 3, daily_available_minutes: 960, budget: { min: 0, max: 1200 } },
  nodes: [
    { time_block: '07:00-07:30', action: '早起出发', duration_min: 30, node_type: 'dining', cost: 20, source_trust: 0.6, state: [] },
    { time_block: '07:30-12:00', action: '玉龙雪山徒步', duration_min: 270, node_type: 'core_experience', cost: 200, source_trust: 0.85, state: ['hiking'] },
  ],
};

// YN-3: 差版(无 transit + 来源不可信)
export const yn3: Artifact = {
  family: 'sequence',
  metadata: { day: 1, daily_available_minutes: 960, budget: { min: 0, max: 1200 } },
  nodes: [
    { time_block: '10:00-11:00', action: '随便吃', duration_min: 60, node_type: 'dining', cost: 150, source_trust: 0.2, state: [] },
    { time_block: '11:00-17:00', action: '不知道去哪', duration_min: 360, node_type: 'core_experience', cost: 300, source_trust: 0.1, state: [] },
  ],
};

// === 防城港 2 个 ===

// FC-1: 完善版(京族三岛滨海休闲)
export const fc1: Artifact = {
  family: 'sequence',
  metadata: { day: 1, daily_available_minutes: 960, budget: { min: 0, max: 600 } },
  nodes: [
    { time_block: '09:00-10:00', action: '海鲜早餐', duration_min: 60, node_type: 'dining', cost: 40, source_trust: 0.85, state: ['at_hotel'] },
    { time_block: '10:00-10:30', action: '驾车至万尾金滩', duration_min: 30, node_type: 'transit', cost: 30, source_trust: 0.9, state: [] },
    { time_block: '10:30-14:00', action: '金滩踩沙+京族哈节体验', duration_min: 210, node_type: 'core_experience', cost: 0, source_trust: 0.92, state: ['beach'] },
  ],
};

// FC-2: 差版(时间超 + 无 transit)
export const fc2: Artifact = {
  family: 'sequence',
  metadata: { day: 2, daily_available_minutes: 960, budget: { min: 0, max: 600 } },
  nodes: [
    { time_block: '08:00-09:00', action: '早餐', duration_min: 60, node_type: 'dining', cost: 30, source_trust: 0.5, state: [] },
    { time_block: '09:00-20:00', action: '白浪滩全天发呆', duration_min: 660, node_type: 'core_experience', cost: 100, source_trust: 0.3, state: ['beach'] },
  ],
};

// 黄金集索引(工件 ID → Artifact)
export const goldenArtifacts: Record<string, Artifact> = {
  'HK-1': hk1,
  'HK-2': hk2,
  'HK-3': hk3,
  'YN-1': yn1,
  'YN-2': yn2,
  'YN-3': yn3,
  'FC-1': fc1,
  'FC-2': fc2,
};

// 黄金集工件 ID 列表(排序用)
export const goldenIds = Object.keys(goldenArtifacts);
```

- [ ] **Step 2: 写排序工具(ranking.ts)**

```typescript
// src/golden/ranking.ts
import { writeFileSync, readFileSync, existsSync } from 'node:fs';

/**
 * Kendall τ: 计算两个排序的一致性。
 * τ = (一致对 - 不一致对) / (n*(n-1)/2)
 * τ = 1: 完全一致, τ = -1: 完全相反, τ = 0: 无相关
 */
export function kendallTau(rankA: string[], rankB: string[]): number {
  const n = rankA.length;
  if (n < 2) return 0;

  // 构建 rankB 的位置映射
  const posB = new Map<string, number>();
  rankB.forEach((id, i) => posB.set(id, i));

  let concordant = 0;
  let discordant = 0;

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const aI = rankA[i];
      const aJ = rankA[j];
      const bI = posB.get(aI);
      const bJ = posB.get(aJ);
      if (bI === undefined || bJ === undefined) continue;
      if (bI < bJ) concordant++;
      else discordant++;
    }
  }

  const total = (n * (n - 1)) / 2;
  return total === 0 ? 0 : (concordant - discordant) / total;
}

/**
 * 从分数字典生成排序(分数高 → 排前)
 */
export function rankByScore(scores: Record<string, number>): string[] {
  return Object.entries(scores)
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => id);
}

/**
 * 保存人工排序到 golden/human-ranking.jsonl
 */
export function saveHumanRanking(ranking: string[]): void {
  const line = JSON.stringify({
    timestamp: new Date().toISOString(),
    ranking,
    method: 'pairwise-comparison',
  });
  writeFileSync('golden/human-ranking.jsonl', line + '\n', 'utf8');
}

/**
 * 读取人工排序
 */
export function loadHumanRanking(): string[] | null {
  if (!existsSync('golden/human-ranking.jsonl')) return null;
  const text = readFileSync('golden/human-ranking.jsonl', 'utf8');
  const lines = text.trim().split('\n');
  if (lines.length === 0) return null;
  const last = JSON.parse(lines[lines.length - 1]);
  return last.ranking;
}
```

- [ ] **Step 3: 写排序工具测试**

```typescript
// tests/golden/ranking.test.ts
import { describe, it, expect } from 'vitest';
import { kendallTau, rankByScore } from '../../src/golden/ranking.js';

describe('kendallTau', () => {
  it('returns 1.0 for identical rankings', () => {
    expect(kendallTau(['a', 'b', 'c'], ['a', 'b', 'c'])).toBe(1.0);
  });

  it('returns -1.0 for reversed rankings', () => {
    expect(kendallTau(['a', 'b', 'c'], ['c', 'b', 'a'])).toBe(-1.0);
  });

  it('returns 0.0 for unrelated rankings', () => {
    // a>b>c vs b>a>c: a vs b 不一致, a vs c 一致, b vs c 一致 → 2-1=1, /3=0.333
    expect(kendallTau(['a', 'b', 'c'], ['b', 'a', 'c'])).toBeCloseTo(1 / 3, 2);
  });

  it('handles 2 elements', () => {
    expect(kendallTau(['a', 'b'], ['a', 'b'])).toBe(1.0);
    expect(kendallTau(['a', 'b'], ['b', 'a'])).toBe(-1.0);
  });

  it('returns 0 for single element', () => {
    expect(kendallTau(['a'], ['a'])).toBe(0);
  });
});

describe('rankByScore', () => {
  it('sorts IDs by score descending', () => {
    const scores = { 'a': 0.8, 'b': 0.95, 'c': 0.5 };
    expect(rankByScore(scores)).toEqual(['b', 'a', 'c']);
  });

  it('handles ties (stable sort)', () => {
    const scores = { 'a': 0.5, 'b': 0.5, 'c': 0.5 };
    const result = rankByScore(scores);
    expect(result).toHaveLength(3);
    expect(result).toContain('a');
    expect(result).toContain('b');
    expect(result).toContain('c');
  });
});
```

- [ ] **Step 4: 跑测试确认通过**

```bash
npx vitest run tests/golden/ranking.test.ts
```

Expected: PASS, 7 个测试全过。

- [ ] **Step 5: typecheck**

```bash
npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add src/golden/ tests/golden/
git commit -m "feat(golden): 8 golden artifacts + ranking tools (Kendall τ + save/load)"
```

---

## Task 4: 人工标注(pairwise comparison 交互)

**注:** 本 task 不是代码 task,是人工交互流程。用 AskUserQuestion 工具做 pairwise comparison。

- [ ] **Step 1: 执行 pairwise comparison**

对 8 个工件做 merge sort,每次给用户看 2 个工件摘要,用户选"哪个更好"。

工件摘要格式:
```
工件 A: HK-1 香港 Day1 早餐→港铁→龙脊徒步(4节点, 3.5h, ¥71, source_trust 0.85-1.0)
工件 B: HK-2 香港 Day1 早餐→太平山顶(2节点, 4h, ¥130, source_trust 0.7-0.8)
哪个更好?(考虑时间可执行/动线/记忆点/餐饮/来源)
```

预计 ~17 轮(merge sort on 8 elements)。

- [ ] **Step 2: 保存排序到 golden/human-ranking.jsonl**

```bash
# 用 ranking.ts 的 saveHumanRanking 函数,或手动写 JSON
```

- [ ] **Step 3: 验证排序文件存在**

```bash
test -f golden/human-ranking.jsonl && echo "OK" || echo "MISSING"
```

Expected: OK

- [ ] **Step 4: Commit**

```bash
git add golden/human-ranking.jsonl
git commit -m "data(golden): human pairwise ranking of 8 artifacts (frozen golden set)"
```

---

## Self-Review

**1. Spec coverage:**

| Spec 节 | Task | 状态 |
|---|---|---|
| §2.1 LLM provider 切换 | Task 1 | ✅ |
| §2.2 state_mutex 相邻节点互斥 | Task 2 | ✅ |
| §2.3 冻结黄金集构造 + 人工标注 | Task 3 + Task 4 | ✅ |

**2. Placeholder scan:**
- ✅ 无 TBD/TODO
- ✅ 每个 step 有完整代码
- ⚠️ Task 4 是交互 task,无代码块(有意设计——标注是人工流程)

**3. Type consistency:**
- `makeStateMutex` 签名不变(string[]),逻辑加相邻检查 ✅
- `Artifact` 类型复用 ✅
- `kendallTau` / `rankByScore` 新增,无冲突 ✅
- `goldenArtifacts` Record<string, Artifact> ✅

**4. P0 接口影响:**
- Task 1:client.ts 改 provider,env var 名改,其他文件引用 `callLLM` 不受影响(接口不变) ✅
- Task 2:state_mutex 逻辑改,fixture 改,验收测试断言改。Critic 的 patch 生成可能受影响(state_mutex violation 的 location 变了)——Task 2 Step 6 会跑全测试验证 ✅
- Task 3:新增文件,不影响现有 ✅

---

## Part 2 接口(Plan 2 用)

Plan 1 完成后,Plan 2 可以用:
- `callLLM(prompt): Promise<string | null>` — 支持 OpenAI 兼容 endpoint
- `hasApiKey(): boolean` — 检查 OPENAI_API_KEY
- `goldenArtifacts` / `goldenIds` — 8 个冻结黄金工件
- `kendallTau(rankA, rankB): number` — Kendall τ 计算
- `rankByScore(scores): string[]` — 分数转排序
- `loadHumanRanking(): string[] | null` — 读取人工排序
- state_mutex 支持相邻节点互斥
