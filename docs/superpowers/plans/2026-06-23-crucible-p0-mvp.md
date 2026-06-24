# Crucible P0 MVP Implementation Plan (Part 1 of 2: Contract Kernel + Deterministic Scoring)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 crucible/dev worktree 内,实现 Contract v1.0 schema + 4 条确定性硬约束 + 2 条确定性 rubric + Scorer 编译器,让 3 个真实 bug 被自动抓出,完成 PRD P0 验收 4.1 + 4.5。

**Architecture:** Approach D(Mastra-native,不 fork)。TypeScript + Vitest。Contract YAML → 编译器 → 可执行 Scorer 函数。Part 1 只做确定性部分(零 LLM 调用),Part 2 才加 Mastra agent + judge + 提分迭代。

**Tech Stack:** TypeScript 5.x, Node.js 20+, Vitest 1.x, yaml@2.x (解析), zod@3.x (schema 校验)。无 Mastra、无 LLM API——Part 2 才引入。

**Spec:** `docs/superpowers/specs/crucible-p0-spec.md`

**Part 2 接口(本 plan 不实现,但 Part 1 要为其预留):**
- `compileContract(contract: Contract): Scorer` 返回的 Scorer 必须可被 Part 2 的 Scorer Agent 调用
- `ScoreReport` 类型必须包含 `deterministic` + `judge` 两个子对象,Part 1 只填 `deterministic`
- `contracts/travel-sequence-v1.yaml` 是 Contract-Author Agent(Part 2)的产出目标格式

---

## File Structure

```
crucible-dev/
├── src/
│   ├── contract/
│   │   ├── schema.ts          # Contract v1.0 TypeScript 类型(zod)
│   │   ├── validate.ts        # YAML → Contract 校验器
│   │   └── compiler.ts        # Contract → Scorer 编译器
│   ├── predicates/
│   │   ├── types.ts           # Predicate 接口 + Violation 类型
│   │   ├── continuity.ts      # 相邻节点必有 transit/switch
│   │   ├── state_mutex.ts     # 互斥 state 不能同现
│   │   ├── time_budget.ts     # 单日 duration ≤ 可用时长
│   │   └── no_duplicate_state.ts  # state 不能连续两节点出现无清除
│   ├── rubric/
│   │   ├── types.ts           # Rubric 接口 + RubricScore 类型
│   │   ├── cost_fit.ts        # deterministic: 总 cost 在预算区间
│   │   └── source_trust.ts    # deterministic: 加权平均 source_trust
│   ├── scorer/
│   │   ├── types.ts           # Scorer 接口 + ScoreReport 类型
│   │   └── deterministic.ts   # 跑全部硬约束 + 确定性 rubric
│   └── fixtures/
│       ├── hk-3day-golden.ts  # q-traveller 转换的黄金工件(无 bug)
│       └── hk-3day-buggy.ts   # 注入 3 bug 的工件
├── contracts/
│   └── travel-sequence-v1.yaml  # Contract v1.0 YAML
├── tests/
│   ├── contract/
│   │   ├── schema.test.ts
│   │   ├── validate.test.ts
│   │   └── compiler.test.ts
│   ├── predicates/
│   │   ├── continuity.test.ts
│   │   ├── state_mutex.test.ts
│   │   ├── time_budget.test.ts
│   │   └── no_duplicate_state.test.ts
│   ├── rubric/
│   │   ├── cost_fit.test.ts
│   │   └── source_trust.test.ts
│   ├── scorer/
│   │   └── deterministic.test.ts
│   └── fixtures/
│       └── acceptance.test.ts  # 验收 4.1:3 bug 必须被抓出
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

**职责边界:**
- `contract/` — 契约的 schema/校验/编译,不知道具体谓词实现
- `predicates/` — 硬约束谓词,纯函数 `(artifact) → Violation[]`,不依赖 contract schema
- `rubric/` — 评分维度,纯函数 `(artifact) → RubricScore`,deterministic 模式
- `scorer/` — 编译器产出,把 predicates + rubric 组装成一次完整打分
- `fixtures/` — 测试数据,黄金工件和 buggy 工件

---

## Task 1: 项目脚手架(package.json + tsconfig + vitest)

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `.gitignore`

- [ ] **Step 1: 初始化 package.json**

```bash
cd /mnt/d/Apps/traveller.crucible-dev
npm init -y
```

然后编辑 `package.json` 为:

```json
{
  "name": "crucible",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "yaml": "^2.4.0",
    "zod": "^3.22.0"
  },
  "devDependencies": {
    "typescript": "^5.4.0",
    "vitest": "^1.6.0",
    "@types/node": "^20.12.0"
  }
}
```

- [ ] **Step 2: 创建 tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "types": ["node"]
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

- [ ] **Step 3: 创建 vitest.config.ts**

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
```

- [ ] **Step 4: 创建 .gitignore**

```
node_modules/
dist/
.env
*.log
.gstack/
```

- [ ] **Step 5: 安装依赖**

```bash
npm install
```

Expected: 依赖安装成功,`node_modules/` 创建,无错误。

- [ ] **Step 6: 验证脚手架能跑**

```bash
npx vitest run
```

Expected: `No test files found` (因为还没写测试),exit code 0。

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json tsconfig.json vitest.config.ts .gitignore
git commit -m "chore: scaffold crucible project (ts + vitest + zod + yaml)"
```

---

## Task 2: Contract v1.0 Schema(zod 类型定义)

**Files:**
- Create: `src/contract/schema.ts`
- Test: `tests/contract/schema.test.ts`

- [ ] **Step 1: 写失败测试**

```typescript
// tests/contract/schema.test.ts
import { describe, it, expect } from 'vitest';
import { ContractSchema, type Contract } from '../../src/contract/schema.js';

describe('ContractSchema', () => {
  it('parses a valid sequence contract', () => {
    const raw = {
      artifact_family: 'sequence',
      fields: [
        { name: 'time_block', type: 'string', required: true },
        { name: 'node_type', type: 'enum', required: true, values: ['hard', 'transit'] },
      ],
      hard_constraints: [
        { id: 'continuity', type: 'declarative', rule: 'adjacent must have transit' },
      ],
      rubric: [
        { dim: 'cost_fit', weight: 0.5, mode: 'deterministic' },
      ],
      calibration: {
        frozen_golden_set: 'golden/hk.jsonl',
        metric: 'kendall_tau',
      },
    };
    const result = ContractSchema.parse(raw);
    expect(result.artifact_family).toBe('sequence');
    expect(result.fields).toHaveLength(2);
    expect(result.hard_constraints).toHaveLength(1);
    expect(result.rubric[0].weight).toBe(0.5);
  });

  it('rejects rubric weights not summing to 1.0', () => {
    const raw = {
      artifact_family: 'sequence',
      fields: [{ name: 'x', type: 'string', required: true }],
      hard_constraints: [],
      rubric: [
        { dim: 'a', weight: 0.3, mode: 'deterministic' },
        { dim: 'b', weight: 0.3, mode: 'deterministic' },
      ],
      calibration: { frozen_golden_set: 'x', metric: 'kendall_tau' },
    };
    expect(() => ContractSchema.parse(raw)).toThrow();
  });

  it('rejects unknown artifact_family', () => {
    const raw = {
      artifact_family: 'bogus',
      fields: [],
      hard_constraints: [],
      rubric: [],
      calibration: { frozen_golden_set: 'x', metric: 'kendall_tau' },
    };
    expect(() => ContractSchema.parse(raw)).toThrow();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
npx vitest run tests/contract/schema.test.ts
```

Expected: FAIL,`Cannot find module '../../src/contract/schema.js'`

- [ ] **Step 3: 写最小实现**

```typescript
// src/contract/schema.ts
import { z } from 'zod';

const FieldType = z.enum(['string', 'integer', 'number', 'enum', 'string[]']);

const FieldDef = z.object({
  name: z.string(),
  type: FieldType,
  required: z.boolean(),
  values: z.array(z.string()).optional(),
});

const HardConstraint = z.discriminatedUnion('type', [
  z.object({
    id: z.string(),
    type: z.literal('declarative'),
    rule: z.string().optional(),
    mutex: z.array(z.string()).optional(),
  }),
  z.object({
    id: z.string(),
    type: z.literal('code_predicate'),
    impl: z.string(),
    threshold: z.number().optional(),
  }),
]);

const RubricMode = z.enum(['deterministic', 'judge', 'proxy+judge']);

const RubricEntry = z.object({
  dim: z.string(),
  weight: z.number().min(0).max(1),
  mode: RubricMode,
});

const Calibration = z.object({
  frozen_golden_set: z.string(),
  metric: z.enum(['kendall_tau', 'spearman_rho']),
  human_ceiling: z.string().optional(),
});

export const ContractSchema = z.object({
  artifact_family: z.enum(['sequence', 'table', 'brief', 'roster']),
  fields: z.array(FieldDef),
  hard_constraints: z.array(HardConstraint),
  rubric: z.array(RubricEntry)
    .refine(entries => {
      const sum = entries.reduce((acc, e) => acc + e.weight, 0);
      return Math.abs(sum - 1.0) < 0.001;
    }, 'rubric weights must sum to 1.0'),
  calibration: Calibration,
});

export type Contract = z.infer<typeof ContractSchema>;
export type FieldDef = z.infer<typeof FieldDef>;
export type HardConstraint = z.infer<typeof HardConstraint>;
export type RubricEntry = z.infer<typeof RubricEntry>;
```

- [ ] **Step 4: 跑测试确认通过**

```bash
npx vitest run tests/contract/schema.test.ts
```

Expected: PASS,3 个测试全过。

- [ ] **Step 5: Commit**

```bash
git add src/contract/schema.ts tests/contract/schema.test.ts
git commit -m "feat(contract): Contract v1.0 zod schema with weight-sum validation"
```

---

## Task 3: Contract YAML 文件 + validate.ts(加载 + 校验)

**Files:**
- Create: `contracts/travel-sequence-v1.yaml`
- Create: `src/contract/validate.ts`
- Test: `tests/contract/validate.test.ts`

- [ ] **Step 1: 写 Contract YAML 文件**

```yaml
# contracts/travel-sequence-v1.yaml
artifact_family: sequence
fields:
  - {name: time_block,    type: string,   required: true}
  - {name: action,        type: string,   required: true}
  - {name: route,         type: string,   required: false}
  - {name: duration_min,  type: integer,  required: true}
  - {name: node_type,     type: enum,     required: true, values: [hard, transit, switch, core_experience, checkin, dining, buffer]}
  - {name: elasticity,    type: enum,     required: true, values: [non_compressible, compressible, replaceable]}
  - {name: cost,          type: number,   required: false}
  - {name: source,        type: string,   required: false}
  - {name: source_trust,  type: number,   required: false}
  - {name: state,         type: 'string[]', required: false}
hard_constraints:
  - id: continuity
    type: declarative
    rule: "every adjacent pair of nodes must have a transit or switch between them"
  - id: state_mutex
    type: declarative
    mutex: [luggage_drop, depart_from_hotel]
  - id: time_budget
    type: declarative
    rule: "sum(duration_min) for each day ≤ daily_available_minutes (default 960)"
  - id: no_duplicate_state
    type: declarative
    rule: "no state token appears in two consecutive nodes without a clearing transition"
rubric:
  - {dim: routing,        weight: 0.25, mode: proxy+judge}
  - {dim: memorability,   weight: 0.25, mode: judge}
  - {dim: dining_fit,     weight: 0.15, mode: judge}
  - {dim: cost_fit,       weight: 0.15, mode: deterministic}
  - {dim: source_trust,   weight: 0.20, mode: deterministic}
calibration:
  frozen_golden_set: golden/hk-3day-v1.jsonl
  metric: kendall_tau
  # human_ceiling 留 P1(P0 无校准数据,字段 optional 自动省略)
```

- [ ] **Step 2: 写失败测试**

```typescript
// tests/contract/validate.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadContract } from '../../src/contract/validate.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_CONTRACT = join(__dirname, '..', '..', 'contracts', 'travel-sequence-v1.yaml');

describe('loadContract', () => {
  it('loads and validates travel-sequence-v1.yaml', () => {
    const contract = loadContract(FIXTURE_CONTRACT);
    expect(contract.artifact_family).toBe('sequence');
    expect(contract.fields).toHaveLength(10);
    expect(contract.hard_constraints).toHaveLength(4);
    expect(contract.rubric).toHaveLength(5);
    expect(contract.hard_constraints.find(c => c.id === 'state_mutex')?.type).toBe('declarative');
  });

  it('throws on malformed YAML', () => {
    const tmpPath = join(__dirname, 'tmp-malformed.yaml');
    writeFileSync(tmpPath, 'artifact_family: [unclosed');
    expect(() => loadContract(tmpPath)).toThrow();
    unlinkSync(tmpPath);
  });

  it('throws on schema-invalid contract', () => {
    const tmpPath = join(__dirname, 'tmp-bad.yaml');
    writeFileSync(tmpPath, 'artifact_family: bogus\nfields: []\n');
    expect(() => loadContract(tmpPath)).toThrow();
    unlinkSync(tmpPath);
  });
});

import { writeFileSync, unlinkSync } from 'node:fs';
```

- [ ] **Step 3: 跑测试确认失败**

```bash
npx vitest run tests/contract/validate.test.ts
```

Expected: FAIL,`Cannot find module '../../src/contract/validate.js'`

- [ ] **Step 4: 写最小实现**

```typescript
// src/contract/validate.ts
import { readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import { ContractSchema, type Contract } from './schema.js';

export function loadContract(path: string): Contract {
  const text = readFileSync(path, 'utf8');
  const raw = parseYaml(text);
  return ContractSchema.parse(raw);
}

// 注:parseContractYaml(从字符串解析)在 P0 未使用,留 Part 2 Contract-Author Agent 用。
// 不导出 dead code,Part 2 需要时再加(outside-voice #25)。
```

- [ ] **Step 5: 跑测试确认通过**

```bash
npx vitest run tests/contract/validate.test.ts
```

Expected: PASS,3 个测试全过。

- [ ] **Step 6: Commit**

```bash
git add contracts/travel-sequence-v1.yaml src/contract/validate.ts tests/contract/validate.test.ts
git commit -m "feat(contract): travel-sequence-v1.yaml + loadContract/parseContractYaml"
```

---

## Task 4: Predicate 接口 + Violation 类型

**Files:**
- Create: `src/predicates/types.ts`
- Test: (无独立测试,本 task 只定义类型,被 Task 5-8 间接测试)

- [ ] **Step 1: 写类型定义**

```typescript
// src/predicates/types.ts

/** 一个工件节点,对应 Contract fields 的一行 */
export interface ArtifactNode {
  [fieldName: string]: unknown;
}

/** 完整工件 = 节点序列 */
export interface Artifact {
  family: 'sequence' | 'table' | 'brief' | 'roster';
  nodes: ArtifactNode[];
  metadata?: {
    day?: number;
    daily_available_minutes?: number;
    budget?: { min: number; max: number };
  };
}

/** 硬约束违规 */
export interface Violation {
  constraint_id: string;
  severity: 'hard' | 'soft';
  message: string;
  location: {
    node_index?: number;
    node_index_end?: number;
    field?: string;
  };
  fix_hint?: string;
}

/** 确定性谓词:纯函数,artifact → violations */
export type Predicate = (artifact: Artifact) => Violation[];

// 注:P0 不定义 PredicateFactory——compiler 用 switch(c.id) 硬编码映射,不需要工厂。
// P1 升级 code_predicate.impl 动态加载时再定义 factory 接口(eng-review C2)。
```

- [ ] **Step 2: typecheck**

```bash
npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 3: Commit**

```typescript
// (无测试文件,但 typecheck 通过即视为本 task 完成)
```

```bash
git add src/predicates/types.ts
git commit -m "feat(predicates): Predicate/Violation/Artifact types"
```

---

## Task 5: continuity 谓词

**Files:**
- Create: `src/predicates/continuity.ts`
- Test: `tests/predicates/continuity.test.ts`

**规则:** 每对相邻节点之间,必须存在一个 `transit` 或 `switch` 类型的节点。如果相邻两个非 transit/switch 节点直接相连,违规。

- [ ] **Step 1: 写失败测试**

```typescript
// tests/predicates/continuity.test.ts
import { describe, it, expect } from 'vitest';
import { continuity } from '../../src/predicates/continuity.js';
import type { Artifact } from '../../src/predicates/types.js';

describe('continuity', () => {
  it('passes when adjacent non-transit nodes have transit between them', () => {
    const artifact: Artifact = {
      family: 'sequence',
      nodes: [
        { node_type: 'dining', action: 'breakfast' },
        { node_type: 'transit', action: 'walk to mtr' },
        { node_type: 'core_experience', action: 'hike dragons back' },
      ],
    };
    expect(continuity(artifact)).toEqual([]);
  });

  it('flags when two non-transit nodes are adjacent without a transit/switch', () => {
    const artifact: Artifact = {
      family: 'sequence',
      nodes: [
        { node_type: 'dining', action: 'breakfast' },
        { node_type: 'core_experience', action: 'hike' },
      ],
    };
    const violations = continuity(artifact);
    expect(violations).toHaveLength(1);
    expect(violations[0].constraint_id).toBe('continuity');
    expect(violations[0].location.node_index).toBe(0);
    expect(violations[0].location.node_index_end).toBe(1);
    expect(violations[0].fix_hint).toMatch(/transit|switch/i);
  });

  it('does not flag adjacent transit nodes', () => {
    const artifact: Artifact = {
      family: 'sequence',
      nodes: [
        { node_type: 'transit', action: 'walk' },
        { node_type: 'transit', action: 'mtr' },
      ],
    };
    expect(continuity(artifact)).toEqual([]);
  });

  it('handles empty and single-node artifacts', () => {
    expect(continuity({ family: 'sequence', nodes: [] })).toEqual([]);
    expect(continuity({ family: 'sequence', nodes: [{ node_type: 'hard' }] })).toEqual([]);
  });

  it('flags multiple gaps', () => {
    const artifact: Artifact = {
      family: 'sequence',
      nodes: [
        { node_type: 'dining' },
        { node_type: 'core_experience' },
        { node_type: 'transit' },
        { node_type: 'dining' },
        { node_type: 'checkin' },
      ],
    };
    expect(continuity(artifact)).toHaveLength(2);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
npx vitest run tests/predicates/continuity.test.ts
```

Expected: FAIL,`Cannot find module '../../src/predicates/continuity.js'`

- [ ] **Step 3: 写最小实现**

```typescript
// src/predicates/continuity.ts
import type { Artifact, Predicate, Violation } from './types.js';

const BRIDGE_TYPES = new Set(['transit', 'switch']);

/**
 * continuity: 每对相邻节点之间,必须有 transit 或 switch。
 * 算法:遍历相邻节点对 (i, i+1),如果两个都不是 transit/switch,则违规。
 * 注:相邻两节点只要任一是 transit/switch 即不违规,transit 不要求成对出现。
 *     例如 dining→transit→dining 合法(dining 之间隔了一个 transit 桥)。
 */
export const continuity: Predicate = (artifact: Artifact): Violation[] => {
  const violations: Violation[] = [];
  const nodes = artifact.nodes;
  for (let i = 0; i < nodes.length - 1; i++) {
    const a = nodes[i];
    const b = nodes[i + 1];
    const aIsBridge = BRIDGE_TYPES.has(String(a.node_type ?? ''));
    const bIsBridge = BRIDGE_TYPES.has(String(b.node_type ?? ''));
    if (!aIsBridge && !bIsBridge) {
      violations.push({
        constraint_id: 'continuity',
        severity: 'hard',
        message: `adjacent nodes at index ${i} and ${i + 1} have no transit/switch bridge between them`,
        location: { node_index: i, node_index_end: i + 1 },
        fix_hint: 'insert a transit or switch node between these two nodes',
      });
    }
  }
  return violations;
};
```

- [ ] **Step 4: 跑测试确认通过**

```bash
npx vitest run tests/predicates/continuity.test.ts
```

Expected: PASS,5 个测试全过。

- [ ] **Step 5: Commit**

```bash
git add src/predicates/continuity.ts tests/predicates/continuity.test.ts
git commit -m "feat(predicates): continuity (adjacent non-transit nodes flagged)"
```

---

## Task 6: state_mutex 谓词

**Files:**
- Create: `src/predicates/state_mutex.ts`
- Test: `tests/predicates/state_mutex.test.ts`

**规则:** Contract 里声明的 `mutex: [luggage_drop, depart_from_hotel]` 表示这两个 state token 不能在同一节点或相邻节点同时出现。本 P0 实现"同一节点内不能同时持有互斥 state"。

**技术债(eng-review A2,必须在 plan 显式标注):** P0 只检查同节点互斥。PRD §6 原意是"相邻节点互斥"——真实旅游里 `luggage_drop` 和 `depart_from_hotel` 出现在相邻节点(先寄存后出发),而非同一节点。P0 buggy fixture 被迫把两个 state 塞同一节点触发违规,demo 真实性打折。**P1 升级路径:** 定义 `clearing transition` 语义(node_type 为 `switch`/`buffer` 清除 state),实现相邻节点互斥检查,重做 fixture 让 bug 贴近 q-traveller §7 真实场景。

- [ ] **Step 1: 写失败测试**

```typescript
// tests/predicates/state_mutex.test.ts
import { describe, it, expect } from 'vitest';
import { makeStateMutex } from '../../src/predicates/state_mutex.js';
import type { Artifact } from '../../src/predicates/types.js';

describe('state_mutex', () => {
  const predicate = makeStateMutex(['luggage_drop', 'depart_from_hotel']);

  it('passes when no state tokens', () => {
    const artifact: Artifact = {
      family: 'sequence',
      nodes: [{ action: 'breakfast' }, { action: 'hike' }],
    };
    expect(predicate(artifact)).toEqual([]);
  });

  it('passes when only one mutex token present across artifact', () => {
    const artifact: Artifact = {
      family: 'sequence',
      nodes: [
        { action: 'drop luggage', state: ['luggage_drop'] },
        { action: 'hike' },
      ],
    };
    expect(predicate(artifact)).toEqual([]);
  });

  it('flags when both mutex tokens in the SAME node', () => {
    const artifact: Artifact = {
      family: 'sequence',
      nodes: [
        {
          action: 'confused node',
          state: ['luggage_drop', 'depart_from_hotel'],
        },
      ],
    };
    const violations = predicate(artifact);
    expect(violations).toHaveLength(1);
    expect(violations[0].constraint_id).toBe('state_mutex');
    expect(violations[0].location.node_index).toBe(0);
    expect(violations[0].message).toMatch(/luggage_drop/);
    expect(violations[0].message).toMatch(/depart_from_hotel/);
  });

  it('flags every node that has both mutex tokens', () => {
    const artifact: Artifact = {
      family: 'sequence',
      nodes: [
        { action: 'a', state: ['luggage_drop', 'depart_from_hotel'] },
        { action: 'b' },
        { action: 'c', state: ['luggage_drop', 'depart_from_hotel'] },
      ],
    };
    expect(predicate(artifact)).toHaveLength(2);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
npx vitest run tests/predicates/state_mutex.test.ts
```

Expected: FAIL,`Cannot find module '../../src/predicates/state_mutex.js'`

- [ ] **Step 3: 写最小实现**

```typescript
// src/predicates/state_mutex.ts
import type { Artifact, Predicate, Violation } from './types.js';

/**
 * makeStateMutex: 工厂,接收 mutex token 列表,返回 Predicate。
 * 规则:同一节点内不能同时持有两个 mutex token。
 * P0 只检查同节点互斥。相邻节点互斥留 P1。
 *
 * 注(outside-voice #12):签名用 string[] 而非 [string, string] tuple,
 * 因为 Contract YAML 的 mutex 字段是数组,可能含 2+ token。
 * P0 只取前 2 个检查(见 compiler 调用处),多于 2 个的 token 在 P0 被忽略。
 */
export function makeStateMutex(mutexTokens: string[]): Predicate {
  if (mutexTokens.length < 2) {
    return () => []; // 不足 2 个 token,无法构成互斥对,返回 noop
  }
  const a = mutexTokens[0];
  const b = mutexTokens[1];
  return (artifact: Artifact): Violation[] => {
    const violations: Violation[] = [];
    artifact.nodes.forEach((node, idx) => {
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
    return violations;
  };
}
```

- [ ] **Step 4: 跑测试确认通过**

```bash
npx vitest run tests/predicates/state_mutex.test.ts
```

Expected: PASS,4 个测试全过。

- [ ] **Step 5: Commit**

```bash
git add src/predicates/state_mutex.ts tests/predicates/state_mutex.test.ts
git commit -m "feat(predicates): state_mutex (same-node mutex token pair check)"
```

---

## Task 7: time_budget 谓词

**Files:**
- Create: `src/predicates/time_budget.ts`
- Test: `tests/predicates/time_budget.test.ts`

**规则:** 单日 `duration_min` 之和 ≤ 当日可用时长(默认 960 分钟 = 16 小时)。`metadata.daily_available_minutes` 可覆盖默认。P0 假设整个 artifact 是单日(不支持多日拆分,留 P1)。

- [ ] **Step 1: 写失败测试**

```typescript
// tests/predicates/time_budget.test.ts
import { describe, it, expect } from 'vitest';
import { timeBudget } from '../../src/predicates/time_budget.js';
import type { Artifact } from '../../src/predicates/types.js';

describe('timeBudget', () => {
  it('passes when sum under default 960 min', () => {
    const artifact: Artifact = {
      family: 'sequence',
      nodes: [
        { duration_min: 30 },
        { duration_min: 120 },
        { duration_min: 60 },
      ],
    };
    expect(timeBudget(artifact)).toEqual([]);
  });

  it('flags when sum exceeds default 960 min', () => {
    const artifact: Artifact = {
      family: 'sequence',
      nodes: [
        { duration_min: 500 },
        { duration_min: 500 },
      ],
    };
    const v = timeBudget(artifact);
    expect(v).toHaveLength(1);
    expect(v[0].constraint_id).toBe('time_budget');
    expect(v[0].message).toMatch(/1000/);
    expect(v[0].message).toMatch(/960/);
  });

  it('respects metadata.daily_available_minutes override', () => {
    const artifact: Artifact = {
      family: 'sequence',
      metadata: { daily_available_minutes: 600 },
      nodes: [{ duration_min: 700 }],
    };
    expect(timeBudget(artifact)).toHaveLength(1);
  });

  it('skips nodes without duration_min', () => {
    const artifact: Artifact = {
      family: 'sequence',
      nodes: [{ action: 'x' }, { duration_min: 500 }],
    };
    expect(timeBudget(artifact)).toEqual([]);
  });

  it('handles zero-duration edge case', () => {
    const artifact: Artifact = {
      family: 'sequence',
      nodes: [{ duration_min: 0 }, { duration_min: 0 }],
    };
    expect(timeBudget(artifact)).toEqual([]);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
npx vitest run tests/predicates/time_budget.test.ts
```

Expected: FAIL,`Cannot find module '../../src/predicates/time_budget.js'`

- [ ] **Step 3: 写最小实现**

```typescript
// src/predicates/time_budget.ts
import type { Artifact, Predicate, Violation } from './types.js';

const DEFAULT_DAILY_MINUTES = 960;

/**
 * timeBudget: 单日 duration_min 之和 ≤ daily_available_minutes。
 * P0 假设整个 artifact 是单日。多日拆分留 P1。
 */
export const timeBudget: Predicate = (artifact: Artifact): Violation[] => {
  const limit = artifact.metadata?.daily_available_minutes ?? DEFAULT_DAILY_MINUTES;
  let sum = 0;
  for (const node of artifact.nodes) {
    const d = node.duration_min;
    if (typeof d === 'number' && !Number.isNaN(d)) sum += d;
  }
  if (sum <= limit) return [];
  return [{
    constraint_id: 'time_budget',
    severity: 'hard',
    message: `total duration ${sum} min exceeds daily budget ${limit} min`,
    location: { field: 'duration_min' },
    fix_hint: `reduce total duration by ${sum - limit} min, or raise daily_available_minutes`,
  }];
};
```

- [ ] **Step 4: 跑测试确认通过**

```bash
npx vitest run tests/predicates/time_budget.test.ts
```

Expected: PASS,5 个测试全过。

- [ ] **Step 5: Commit**

```bash
git add src/predicates/time_budget.ts tests/predicates/time_budget.test.ts
git commit -m "feat(predicates): time_budget (single-day duration sum check)"
```

---

## Task 8: no_duplicate_state 谓词

**Files:**
- Create: `src/predicates/no_duplicate_state.ts`
- Test: `tests/predicates/no_duplicate_state.test.ts`

**规则:** 同一 state token 不能连续两节点出现,除非中间有"清除 transition"(node_type 为 `switch` 或 `buffer`)。这是 q-traveller §7 提到的"状态重复"bug 的形式化。

- [ ] **Step 1: 写失败测试**

```typescript
// tests/predicates/no_duplicate_state.test.ts
import { describe, it, expect } from 'vitest';
import { noDuplicateState } from '../../src/predicates/no_duplicate_state.js';
import type { Artifact } from '../../src/predicates/types.js';

describe('noDuplicateState', () => {
  it('passes when no state tokens', () => {
    expect(noDuplicateState({ family: 'sequence', nodes: [{ action: 'a' }, { action: 'b' }] })).toEqual([]);
  });

  it('passes when state token appears once', () => {
    const artifact: Artifact = {
      family: 'sequence',
      nodes: [{ state: ['hungry'] }, { action: 'no state' }],
    };
    expect(noDuplicateState(artifact)).toEqual([]);
  });

  it('passes when same state in non-consecutive nodes', () => {
    const artifact: Artifact = {
      family: 'sequence',
      nodes: [{ state: ['hungry'] }, { action: 'x' }, { state: ['hungry'] }],
    };
    expect(noDuplicateState(artifact)).toEqual([]);
  });

  it('flags when same state in consecutive nodes without clearing transition', () => {
    const artifact: Artifact = {
      family: 'sequence',
      nodes: [
        { action: 'a', state: ['at_hotel'] },
        { action: 'b', state: ['at_hotel'] },
      ],
    };
    const v = noDuplicateState(artifact);
    expect(v).toHaveLength(1);
    expect(v[0].constraint_id).toBe('no_duplicate_state');
    expect(v[0].location.node_index).toBe(0);
    expect(v[0].location.node_index_end).toBe(1);
    expect(v[0].message).toMatch(/at_hotel/);
  });

  it('does not flag when switch node clears state between them', () => {
    const artifact: Artifact = {
      family: 'sequence',
      nodes: [
        { action: 'a', state: ['at_hotel'] },
        { node_type: 'switch', action: 'leave hotel' },
        { action: 'b', state: ['at_hotel'] },
      ],
    };
    expect(noDuplicateState(artifact)).toEqual([]);
  });

  it('does not flag when buffer node clears state between them', () => {
    const artifact: Artifact = {
      family: 'sequence',
      nodes: [
        { action: 'a', state: ['at_hotel'] },
        { node_type: 'buffer', action: 'wait' },
        { action: 'b', state: ['at_hotel'] },
      ],
    };
    expect(noDuplicateState(artifact)).toEqual([]);
  });

  it('flags multiple duplicate states across the artifact', () => {
    const artifact: Artifact = {
      family: 'sequence',
      nodes: [
        { state: ['x'] }, { state: ['x'] },
        { state: ['y'] }, { state: ['y'] },
      ],
    };
    expect(noDuplicateState(artifact)).toHaveLength(2);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
npx vitest run tests/predicates/no_duplicate_state.test.ts
```

Expected: FAIL,`Cannot find module '../../src/predicates/no_duplicate_state.js'`

- [ ] **Step 3: 写最小实现**

```typescript
// src/predicates/no_duplicate_state.ts
import type { Artifact, Predicate, Violation } from './types.js';

const CLEARING_TYPES = new Set(['switch', 'buffer']);

/**
 * noDuplicateState: 同一 state token 不能连续两节点出现,除非中间有 switch/buffer 清除。
 * 算法:遍历相邻节点对 (i, i+1),若两节点都持某 state token 且两节点都不是 clearing type,违规。
 */
export const noDuplicateState: Predicate = (artifact: Artifact): Violation[] => {
  const violations: Violation[] = [];
  const nodes = artifact.nodes;
  for (let i = 0; i < nodes.length - 1; i++) {
    const a = nodes[i];
    const b = nodes[i + 1];
    const aClears = CLEARING_TYPES.has(String(a.node_type ?? ''));
    const bClears = CLEARING_TYPES.has(String(b.node_type ?? ''));
    if (aClears || bClears) continue;
    const aStates = new Set(Array.isArray(a.state) ? a.state.map(String) : []);
    const bStates = Array.isArray(b.state) ? b.state.map(String) : [];
    for (const s of bStates) {
      if (aStates.has(s)) {
        violations.push({
          constraint_id: 'no_duplicate_state',
          severity: 'hard',
          message: `state "${s}" persists across consecutive nodes ${i} and ${i + 1} without a clearing transition`,
          location: { node_index: i, node_index_end: i + 1, field: 'state' },
          fix_hint: 'insert a switch or buffer node between them, or remove the duplicate state',
        });
      }
    }
  }
  return violations;
};
```

- [ ] **Step 4: 跑测试确认通过**

```bash
npx vitest run tests/predicates/no_duplicate_state.test.ts
```

Expected: PASS,7 个测试全过。

- [ ] **Step 5: Commit**

```bash
git add src/predicates/no_duplicate_state.ts tests/predicates/no_duplicate_state.test.ts
git commit -m "feat(predicates): no_duplicate_state (consecutive state without clearing)"
```

---

## Task 9: Rubric 类型 + cost_fit (deterministic)

**Files:**
- Create: `src/rubric/types.ts`
- Create: `src/rubric/cost_fit.ts`
- Test: `tests/rubric/cost_fit.test.ts`

**规则:** `cost_fit` deterministic:总 cost 在 `metadata.budget` 范围内 → 1.0;超预算 → 按比例线性衰减到 0;无 budget → 0.5(neutral,留 P1 改进)。

- [ ] **Step 1: 写 Rubric 类型**

```typescript
// src/rubric/types.ts
import type { Artifact } from '../predicates/types.js';

export interface RubricScore {
  dim: string;
  score: number;        // 0.0 - 1.0
  mode: 'deterministic' | 'judge' | 'proxy+judge';
  rationale: string;
  proxy_value?: number; // for proxy+judge mode
}

/** Deterministic rubric: 纯函数,artifact → RubricScore */
export type DeterministicRubric = (artifact: Artifact) => RubricScore;

/**
 * Rubric 缺失数据默认值约定(eng-review C3):
 * - "无基准=中性 0.5":评估基准缺失(如 cost_fit 无 budget metadata)→ 返回 0.5。
 *   语义:不知道好坏,不奖不罚。适用于"评估对象(基准)缺失"。
 * - "无证据=0.0":被评估物本身缺失(如 source_trust 无 source_trust 字段)→ 返回 0.0。
 *   语义:无来源=不可信,直接罚。适用于"被评估物(证据)缺失"。
 * 新增 deterministic rubric 时,按此约定判断缺失数据走哪种默认。
 */
```

- [ ] **Step 2: 写失败测试**

```typescript
// tests/rubric/cost_fit.test.ts
import { describe, it, expect } from 'vitest';
import { costFit } from '../../src/rubric/cost_fit.js';
import type { Artifact } from '../../src/predicates/types.js';

describe('costFit', () => {
  it('returns 1.0 when total cost is within budget', () => {
    const artifact: Artifact = {
      family: 'sequence',
      metadata: { budget: { min: 0, max: 1000 } },
      nodes: [{ cost: 200 }, { cost: 300 }],
    };
    const r = costFit(artifact);
    expect(r.dim).toBe('cost_fit');
    expect(r.mode).toBe('deterministic');
    expect(r.score).toBe(1.0);
  });

  it('returns linearly decaying score when over budget', () => {
    const artifact: Artifact = {
      family: 'sequence',
      metadata: { budget: { min: 0, max: 1000 } },
      nodes: [{ cost: 1500 }],
    };
    const r = costFit(artifact);
    // 1000 max, 1500 actual → decay = max/actual = 0.666...
    expect(r.score).toBeCloseTo(1000 / 1500, 3);
    expect(r.rationale).toMatch(/over budget/i);
  });

  it('returns 0.5 neutral when no budget metadata', () => {
    const artifact: Artifact = {
      family: 'sequence',
      nodes: [{ cost: 100 }],
    };
    const r = costFit(artifact);
    expect(r.score).toBe(0.5);
    expect(r.rationale).toMatch(/no budget/i);
  });

  it('ignores nodes without cost', () => {
    const artifact: Artifact = {
      family: 'sequence',
      metadata: { budget: { min: 0, max: 500 } },
      nodes: [{ action: 'x' }, { cost: 400 }],
    };
    const r = costFit(artifact);
    expect(r.score).toBe(1.0);
  });

  it('handles zero total cost', () => {
    const artifact: Artifact = {
      family: 'sequence',
      metadata: { budget: { min: 0, max: 500 } },
      nodes: [{ cost: 0 }, { cost: 0 }],
    };
    const r = costFit(artifact);
    expect(r.score).toBe(1.0);
  });
});
```

- [ ] **Step 3: 跑测试确认失败**

```bash
npx vitest run tests/rubric/cost_fit.test.ts
```

Expected: FAIL,`Cannot find module '../../src/rubric/cost_fit.js'`

- [ ] **Step 4: 写最小实现**

```typescript
// src/rubric/cost_fit.ts
import type { Artifact } from '../predicates/types.js';
import type { DeterministicRubric, RubricScore } from './types.js';

/**
 * costFit (deterministic): 总 cost 在 budget.max 内 → 1.0;超 → max/actual 线性衰减;无 budget → 0.5 neutral。
 */
export const costFit: DeterministicRubric = (artifact: Artifact): RubricScore => {
  const budget = artifact.metadata?.budget;
  let total = 0;
  for (const node of artifact.nodes) {
    const c = node.cost;
    if (typeof c === 'number' && !Number.isNaN(c)) total += c;
  }
  if (!budget) {
    return {
      dim: 'cost_fit',
      score: 0.5,
      mode: 'deterministic',
      rationale: `no budget metadata; total cost ${total}; neutral 0.5`,
    };
  }
  if (total <= budget.max) {
    return {
      dim: 'cost_fit',
      score: 1.0,
      mode: 'deterministic',
      rationale: `total cost ${total} within budget [${budget.min}, ${budget.max}]`,
    };
  }
  const score = budget.max / total;
  return {
    dim: 'cost_fit',
    score,
    mode: 'deterministic',
    rationale: `total cost ${total} over budget max ${budget.max}; linear decay to ${score.toFixed(3)}`,
  };
};
```

- [ ] **Step 5: 跑测试确认通过**

```bash
npx vitest run tests/rubric/cost_fit.test.ts
```

Expected: PASS,5 个测试全过。

- [ ] **Step 6: Commit**

```bash
git add src/rubric/types.ts src/rubric/cost_fit.ts tests/rubric/cost_fit.test.ts
git commit -m "feat(rubric): cost_fit deterministic (budget linear decay)"
```

---

## Task 10: source_trust (deterministic)

**Files:**
- Create: `src/rubric/source_trust.ts`
- Test: `tests/rubric/source_trust.test.ts`

**规则:** `source_trust` deterministic:所有节点的 `source_trust` 字段(0.0-1.0)加权平均(每节点等权)。无 source_trust 字段的节点按 0.0 计(P0 简化,P1 改进为"无 source 视为不可信")。

- [ ] **Step 1: 写失败测试**

```typescript
// tests/rubric/source_trust.test.ts
import { describe, it, expect } from 'vitest';
import { sourceTrust } from '../../src/rubric/source_trust.js';
import type { Artifact } from '../../src/predicates/types.js';

describe('sourceTrust', () => {
  it('returns average of source_trust values', () => {
    const artifact: Artifact = {
      family: 'sequence',
      nodes: [
        { source_trust: 0.8 },
        { source_trust: 0.6 },
      ],
    };
    const r = sourceTrust(artifact);
    expect(r.dim).toBe('source_trust');
    expect(r.mode).toBe('deterministic');
    expect(r.score).toBeCloseTo(0.7, 3);
  });

  it('treats missing source_trust as 0.0', () => {
    const artifact: Artifact = {
      family: 'sequence',
      nodes: [
        { source_trust: 1.0 },
        { action: 'no trust field' },
      ],
    };
    const r = sourceTrust(artifact);
    expect(r.score).toBeCloseTo(0.5, 3);
  });

  it('returns 0.0 when all nodes lack source_trust', () => {
    const artifact: Artifact = {
      family: 'sequence',
      nodes: [{ action: 'a' }, { action: 'b' }],
    };
    const r = sourceTrust(artifact);
    expect(r.score).toBe(0.0);
    expect(r.rationale).toMatch(/0 nodes/);
  });

  it('handles empty artifact', () => {
    const r = sourceTrust({ family: 'sequence', nodes: [] });
    expect(r.score).toBe(0.0);
  });

  it('returns 1.0 when all nodes have source_trust 1.0', () => {
    const artifact: Artifact = {
      family: 'sequence',
      nodes: [{ source_trust: 1.0 }, { source_trust: 1.0 }],
    };
    expect(sourceTrust(artifact).score).toBe(1.0);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
npx vitest run tests/rubric/source_trust.test.ts
```

Expected: FAIL

- [ ] **Step 3: 写最小实现**

```typescript
// src/rubric/source_trust.ts
import type { Artifact } from '../predicates/types.js';
import type { DeterministicRubric, RubricScore } from './types.js';

/**
 * sourceTrust (deterministic): 节点 source_trust 字段(0.0-1.0)等权平均。
 * 无 source_trust 字段按 0.0 计。空 artifact 返回 0.0。
 */
export const sourceTrust: DeterministicRubric = (artifact: Artifact): RubricScore => {
  const nodes = artifact.nodes;
  if (nodes.length === 0) {
    return { dim: 'source_trust', score: 0.0, mode: 'deterministic', rationale: 'empty artifact' };
  }
  let sum = 0;
  let withTrust = 0;
  for (const node of nodes) {
    const t = node.source_trust;
    if (typeof t === 'number' && !Number.isNaN(t)) {
      sum += t;
      withTrust++;
    }
  }
  const score = sum / nodes.length; // 缺失字段按 0.0,故分母是全部节点数
  return {
    dim: 'source_trust',
    score,
    mode: 'deterministic',
    rationale: `${withTrust}/${nodes.length} nodes carry source_trust; weighted avg = ${score.toFixed(3)}`,
  };
};
```

- [ ] **Step 4: 跑测试确认通过**

```bash
npx vitest run tests/rubric/source_trust.test.ts
```

Expected: PASS,5 个测试全过。

- [ ] **Step 5: Commit**

```bash
git add src/rubric/source_trust.ts tests/rubric/source_trust.test.ts
git commit -m "feat(rubric): source_trust deterministic (node-weighted avg, missing=0)"
```

---

## Task 11: Scorer 类型 + 编译器 + deterministic scorer

**Files:**
- Create: `src/scorer/types.ts`
- Create: `src/contract/compiler.ts`
- Create: `src/scorer/deterministic.ts`
- Test: `tests/contract/compiler.test.ts`
- Test: `tests/scorer/deterministic.test.ts`

- [ ] **Step 1: 写 Scorer 类型**

```typescript
// src/scorer/types.ts
import type { Violation } from '../predicates/types.js';
import type { RubricScore } from '../rubric/types.js';

export interface DeterministicReport {
  violations: Violation[];
  rubric_scores: RubricScore[];
  hard_violation_count: number;
  /** 确定性部分总分 = 1 - (hard_violation_count * penalty) ,clamp 到 [0,1]。
   *  P0 penalty = 0.15 per violation。*/
  deterministic_score: number;
}

export interface ScoreReport {
  deterministic: DeterministicReport;
  judge: {
    rubric_scores: RubricScore[];
    overall_score: number;
  } | null; // Part 1 永远 null,Part 2 才填
  /** 最终总分 = deterministic_score * 0.6 + judge.overall_score * 0.4 (Part 2 才有意义)
   *  Part 1 阶段 final_score = deterministic_score */
  final_score: number;
}

export interface Scorer {
  score(artifact: import('../predicates/types.js').Artifact): ScoreReport;
}
```

- [ ] **Step 2: 写 compiler 失败测试**

```typescript
// tests/contract/compiler.test.ts
import { describe, it, expect } from 'vitest';
import { compileContract } from '../../src/contract/compiler.js';
import { loadContract } from '../../src/contract/validate.js';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONTRACT_PATH = join(__dirname, '..', '..', 'contracts', 'travel-sequence-v1.yaml');

describe('compileContract', () => {
  it('compiles travel-sequence-v1 into a Scorer with 4 predicates and 2 deterministic rubrics', () => {
    const contract = loadContract(CONTRACT_PATH);
    const scorer = compileContract(contract);
    expect(scorer).toBeDefined();
    expect(typeof scorer.score).toBe('function');
    // 内部状态可观察:compiler 暴露 predicate/rubric 数量
    expect(scorer.deterministicPredicateCount).toBe(4);
    expect(scorer.deterministicRubricCount).toBe(2);
  });

  it('scorer.score returns a ScoreReport with deterministic populated', () => {
    const contract = loadContract(CONTRACT_PATH);
    const scorer = compileContract(contract);
    const artifact = {
      family: 'sequence' as const,
      nodes: [
        { node_type: 'dining', duration_min: 30, action: 'breakfast', state: [] },
        { node_type: 'transit', duration_min: 15, action: 'walk to mtr' },
        { node_type: 'core_experience', duration_min: 120, action: 'hike' },
      ],
    };
    const report = scorer.score(artifact);
    expect(report.deterministic).toBeDefined();
    expect(report.deterministic.hard_violation_count).toBe(0);
    expect(report.judge).toBeNull();
    expect(report.final_score).toBeGreaterThan(0);
  });

  // 错误路径测试(eng-review T1):compiler 静默跳过行为的契约
  it('silently skips state_mutex when mutex field is missing or has fewer than 2 tokens', () => {
    const contract = loadContract(CONTRACT_PATH);
    // 篡改:把 state_mutex 的 mutex 字段删掉
    const broken = {
      ...contract,
      hard_constraints: contract.hard_constraints.map(c =>
        c.id === 'state_mutex'
          ? { id: 'state_mutex', type: 'declarative' as const }
          : c
      ),
    };
    const scorer = compileContract(broken);
    // state_mutex 被跳过,只剩 3 个谓词
    expect(scorer.deterministicPredicateCount).toBe(3);
  });

  it('silently skips unknown constraint IDs', () => {
    const contract = loadContract(CONTRACT_PATH);
    const withUnknown = {
      ...contract,
      hard_constraints: [
        ...contract.hard_constraints,
        { id: 'my_custom_check', type: 'declarative' as const, rule: 'whatever' },
      ],
    };
    const scorer = compileContract(withUnknown);
    // 4 个已知 + 1 个未知被跳过 = 仍 4 个
    expect(scorer.deterministicPredicateCount).toBe(4);
  });

  it('does not compile judge-mode rubrics into deterministic scorer', () => {
    const contract = loadContract(CONTRACT_PATH);
    const scorer = compileContract(contract);
    // Contract 有 5 个 rubric,其中 2 deterministic + 3 judge/proxy+judge
    // deterministicRubricCount 应该只有 2
    expect(scorer.deterministicRubricCount).toBe(2);
    // 跑一次 score,rubric_scores 只含 deterministic 维度
    const artifact = {
      family: 'sequence' as const,
      nodes: [{ node_type: 'dining', duration_min: 30, action: 'x' }],
    };
    const report = scorer.score(artifact);
    const dims = report.deterministic.rubric_scores.map(r => r.dim);
    expect(dims).toEqual(expect.arrayContaining(['cost_fit', 'source_trust']));
    expect(dims).not.toContain('routing');
    expect(dims).not.toContain('memorability');
    expect(dims).not.toContain('dining_fit');
  });
});
```

- [ ] **Step 3: 跑测试确认失败**

```bash
npx vitest run tests/contract/compiler.test.ts
```

Expected: FAIL,`Cannot find module '../../src/contract/compiler.js'`

- [ ] **Step 4: 写 compiler 实现**

```typescript
// src/contract/compiler.ts
import type { Contract } from './schema.js';
import type { Artifact, Predicate } from '../predicates/types.js';
import type { DeterministicRubric } from '../rubric/types.js';
import type { Scorer, ScoreReport } from '../scorer/types.js';
import { continuity } from '../predicates/continuity.js';
import { makeStateMutex } from '../predicates/state_mutex.js';
import { timeBudget } from '../predicates/time_budget.js';
import { noDuplicateState } from '../predicates/no_duplicate_state.js';
import { costFit } from '../rubric/cost_fit.js';
import { sourceTrust } from '../rubric/source_trust.js';

const HARD_VIOLATION_PENALTY = 0.15;

interface CompiledScorer extends Scorer {
  deterministicPredicateCount: number;
  deterministicRubricCount: number;
}

/**
 * compileContract: Contract → Scorer。
 * P0 实现:把 Contract 里的 4 条硬约束映射到固定 4 个 predicate 函数,
 * 把 2 条 deterministic rubric 映射到固定 2 个 rubric 函数。
 * judge/proxy+judge rubric 在 P0 不编译(留 Part 2)。
 *
 * 技术债(eng-review A3):P0 用 switch(c.id) 硬编码谓词映射,Contract 不是真的
 * "可执行"——是"硬编码约束的声明式包装"。schema 里已有 code_predicate 类型(带 impl
 * 字段),但 compiler 不处理它。Contract-Author Agent(Part 2)若生成新约束 ID,
 * compiler 直接跳过。P1 升级路径:用 isolated-vm 沙箱支持 code_predicate.impl 动态加载,
 * 让契约真可执行(贴合 PRD §6 混合 DSL)。P0 避免沙箱依赖 + 安全审计。
 */
export function compileContract(contract: Contract): CompiledScorer {
  const predicates: Predicate[] = [];
  for (const c of contract.hard_constraints) {
    switch (c.id) {
      case 'continuity': predicates.push(continuity); break;
      case 'state_mutex':
        if (c.type === 'declarative' && c.mutex && c.mutex.length >= 2) {
          predicates.push(makeStateMutex([c.mutex[0], c.mutex[1]]));
        }
        break;
      case 'time_budget': predicates.push(timeBudget); break;
      case 'no_duplicate_state': predicates.push(noDuplicateState); break;
      default:
        // 未知约束 P0 跳过(P1 支持 code_predicate impl 加载)
        break;
    }
  }

  const rubrics: DeterministicRubric[] = [];
  for (const r of contract.rubric) {
    if (r.mode !== 'deterministic') continue;
    switch (r.dim) {
      case 'cost_fit': rubrics.push(costFit); break;
      case 'source_trust': rubrics.push(sourceTrust); break;
      default: break;
    }
  }

  return {
    deterministicPredicateCount: predicates.length,
    deterministicRubricCount: rubrics.length,
    score(artifact: Artifact): ScoreReport {
      const allViolations: import('../predicates/types.js').Violation[] = [];
      for (const p of predicates) allViolations.push(...p(artifact));
      const hardViolations = allViolations.filter(v => v.severity === 'hard');
      const rubricScores = rubrics.map(r => r(artifact));
      const deterministicScore = Math.max(
        0,
        1 - hardViolations.length * HARD_VIOLATION_PENALTY
      );
      return {
        deterministic: {
          violations: allViolations,
          rubric_scores: rubricScores,
          hard_violation_count: hardViolations.length,
          deterministic_score: deterministicScore,
        },
        judge: null,
        final_score: deterministicScore,
      };
    },
  };
}
```

- [ ] **Step 5: 跑测试确认通过**

```bash
npx vitest run tests/contract/compiler.test.ts
```

Expected: PASS,5 个测试全过(2 happy path + 3 错误路径,eng-review T1)。

- [ ] **Step 6: Commit**

```bash
git add src/scorer/types.ts src/contract/compiler.ts tests/contract/compiler.test.ts
git commit -m "feat(scorer): compileContract + deterministic scorer (4 predicates + 2 rubrics)"
```

---

## Task 12: 黄金工件 fixture(无 bug 的香港 3 天)

**Files:**
- Create: `src/fixtures/hk-3day-golden.ts`

这个 fixture 来自 q-traveller §6.3 的节点 JSON 结构,转成 Contract fields。手工构造一个 3 节点的"早餐 → 地铁 → 龙脊徒步"片段(无 bug 版本)。

- [ ] **Step 1: 写 fixture**

```typescript
// src/fixtures/hk-3day-golden.ts
import type { Artifact } from '../predicates/types.js';

/**
 * 香港 3 天黄金片段(Day 1 上午,简化版)。
 * 来源:q-traveller §6.3 节点 JSON 结构 + §7 主线"早餐→地铁→龙脊"。
 * 这版无 bug:每对相邻节点有 transit/switch,state 无互斥/重复,时间不超。
 */
export const hk3dayGolden: Artifact = {
  family: 'sequence',
  metadata: {
    day: 1,
    daily_available_minutes: 960,
    budget: { min: 0, max: 800 },
  },
  nodes: [
    {
      time_block: '08:00-08:30',
      action: '早餐 茶餐厅',
      route: '酒店 → 油麻地茶餐厅',
      duration_min: 30,
      node_type: 'dining',
      elasticity: 'compressible',
      cost: 50,
      source: '小红书 v1 笔记',
      source_trust: 0.85,
      state: ['at_hotel'],
    },
    {
      time_block: '08:30-09:00',
      action: '步行至油麻地地铁站 + 港铁至筲箕湾',
      route: '油麻地 → 筲箕湾站 A2',
      duration_min: 30,
      node_type: 'transit',
      elasticity: 'non_compressible',
      cost: 15,
      source: 'MTR 官方',
      source_trust: 1.0,
      state: [],
    },
    {
      time_block: '09:00-09:15',
      action: '筲箕湾站 A2 出口 → 9 号巴士总站',
      route: '筲箕湾站 A2 → 巴士总站',
      duration_min: 15,
      node_type: 'switch',
      elasticity: 'non_compressible',
      cost: 0,
      source: 'hkbus9.html',
      source_trust: 0.9,
      state: [],
    },
    {
      time_block: '09:15-09:30',
      action: '9 号巴士至土地湾',
      route: '筲箕湾巴士总站 → 土地湾',
      duration_min: 15,
      node_type: 'transit',
      elasticity: 'non_compressible',
      cost: 6,
      source: 'hkbus9.html',
      source_trust: 0.9,
      state: [],
    },
    {
      time_block: '09:30-11:30',
      action: '龙脊徒步精华段',
      route: '土地湾 → 大潭峡',
      duration_min: 120,
      node_type: 'core_experience',
      elasticity: 'non_compressible',
      cost: 0,
      source: 'dhk_dragonback_zh.html',
      source_trust: 0.95,
      state: ['hiking'],
    },
  ],
};
```

- [ ] **Step 2: typecheck**

```bash
npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add src/fixtures/hk-3day-golden.ts
git commit -m "feat(fixtures): hk-3day-golden (q-traveller §6.3 / §7 breakfast→mtr→dragons-back)"
```

---

## Task 13: buggy 工件 fixture(注入 3 个真实 bug)

**Files:**
- Create: `src/fixtures/hk-3day-buggy.ts`

基于 golden fixture,故意注入 3 个 bug(贴近 q-traveller §7 三段式 demo 的真实场景):
1. `continuity` 违规:早餐 dining 后直接跳 core_experience,中间缺 transit/switch(对应"早餐后→地铁缺切换")
2. `state_mutex` 违规:节点 0 同时持有 luggage_drop 和 depart_from_hotel(对应"寄存行李与从酒店出发互斥重复")
3. `no_duplicate_state` 违规:节点 0 和节点 1 都持有 at_hotel,中间无 clearing transition(对应"状态重复")

设计原则:bug 真实贴近 q-traveller §7 描述,而非人为构造连串非 bridge 节点。共 3 个 hard violation(1 continuity + 1 mutex + 1 duplicate)。

- [ ] **Step 1: 写 buggy fixture**

```typescript
// src/fixtures/hk-3day-buggy.ts
import type { Artifact } from '../predicates/types.js';

/**
 * 香港 3 天 buggy 版本(Day 1 上午)。
 * 基于 hk3dayGolden,故意注入 3 个真实 bug(对应 q-traveller §7 三段式 demo):
 *
 * Bug 1 (continuity): 节点 0(dining) → 节点 1(core_experience),
 *   两个都不是 bridge,缺 transit/switch。对应"早餐后→地铁缺切换"。
 *
 * Bug 2 (state_mutex): 节点 0 同时持有 luggage_drop 和 depart_from_hotel。
 *   对应"寄存行李与从酒店出发状态互斥重复"。
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
      state: ['at_hotel', 'luggage_drop', 'depart_from_hotel'], // Bug 2: mutex 同节点 + Bug 3 起点
    },
    {
      // Bug 1: dining 直接接 core_experience,中间无 transit/switch
      // Bug 3: at_hotel 与节点 0 重复,无 clearing transition
      time_block: '08:30-11:30',
      action: '龙脊徒步精华段',
      route: '土地湾 → 大潭峡',
      duration_min: 180,
      node_type: 'core_experience',
      elasticity: 'non_compressible',
      cost: 0,
      source: 'dhk_dragonback_zh.html',
      source_trust: 0.95,
      state: ['at_hotel', 'hiking'],
    },
  ],
};
```

- [ ] **Step 2: typecheck**

```bash
npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add src/fixtures/hk-3day-buggy.ts
git commit -m "feat(fixtures): hk-3day-buggy (3 injected bugs: continuity/state_mutex/no_duplicate_state)"
```

---

## Task 14: 验收测试 — 3 个 bug 必须被 Scorer 抓出

**Files:**
- Test: `tests/fixtures/acceptance.test.ts`

这是 P0 验收 4.1 的可执行形式。如果这个测试过,P0 确定性部分核心目标达成。

- [ ] **Step 1: 写验收测试**

```typescript
// tests/fixtures/acceptance.test.ts
import { describe, it, expect } from 'vitest';
import { loadContract } from '../../src/contract/validate.js';
import { compileContract } from '../../src/contract/compiler.js';
import { hk3dayBuggy } from '../../src/fixtures/hk-3day-buggy.js';
import { hk3dayGolden } from '../../src/fixtures/hk-3day-golden.js';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONTRACT_PATH = join(__dirname, '..', '..', 'contracts', 'travel-sequence-v1.yaml');

describe('P0 acceptance 4.1 — 3 bugs must be caught by deterministic scorer', () => {
  const contract = loadContract(CONTRACT_PATH);
  const scorer = compileContract(contract);

  it('golden artifact has zero hard violations', () => {
    const report = scorer.score(hk3dayGolden);
    expect(report.deterministic.hard_violation_count).toBe(0);
    expect(report.deterministic.violations).toEqual([]);
  });

  it('buggy artifact catches continuity violation (Bug 1)', () => {
    const report = scorer.score(hk3dayBuggy);
    const continuityV = report.deterministic.violations.filter(
      v => v.constraint_id === 'continuity'
    );
    expect(continuityV).toHaveLength(1); // dining(0) → core_experience(1)
    expect(continuityV[0].location.node_index).toBe(0);
    expect(continuityV[0].location.node_index_end).toBe(1);
  });

  it('buggy artifact catches state_mutex violation (Bug 2)', () => {
    const report = scorer.score(hk3dayBuggy);
    const mutexV = report.deterministic.violations.filter(
      v => v.constraint_id === 'state_mutex'
    );
    expect(mutexV).toHaveLength(1);
    expect(mutexV[0].message).toMatch(/luggage_drop/);
    expect(mutexV[0].message).toMatch(/depart_from_hotel/);
  });

  it('buggy artifact catches no_duplicate_state violation (Bug 3)', () => {
    const report = scorer.score(hk3dayBuggy);
    const dupV = report.deterministic.violations.filter(
      v => v.constraint_id === 'no_duplicate_state'
    );
    expect(dupV).toHaveLength(1);
    expect(dupV[0].message).toMatch(/at_hotel/);
  });

  it('buggy artifact has exactly 3 hard violations total (1 continuity + 1 mutex + 1 duplicate)', () => {
    const report = scorer.score(hk3dayBuggy);
    expect(report.deterministic.hard_violation_count).toBe(3);
  });

  it('buggy artifact scores lower than golden', () => {
    const goldenReport = scorer.score(hk3dayGolden);
    const buggyReport = scorer.score(hk3dayBuggy);
    expect(buggyReport.final_score).toBeLessThan(goldenReport.final_score);
  });

  // fix_hint + location 契约(eng-review T2):为 Part 2 Critic Agent 预留可读契约
  it('every violation has non-empty fix_hint and correct location', () => {
    const report = scorer.score(hk3dayBuggy);
    for (const v of report.deterministic.violations) {
      expect(v.fix_hint, `violation ${v.constraint_id} missing fix_hint`).toBeTruthy();
      expect(v.fix_hint.length, `violation ${v.constraint_id} fix_hint too short`).toBeGreaterThan(10);
      expect(v.location, `violation ${v.constraint_id} missing location`).toBeDefined();
    }
  });

  it('continuity violation points to node 0→1 (dining→core_experience gap)', () => {
    const report = scorer.score(hk3dayBuggy);
    const v = report.deterministic.violations.find(v => v.constraint_id === 'continuity');
    expect(v).toBeDefined();
    expect(v!.location.node_index).toBe(0);
    expect(v!.location.node_index_end).toBe(1);
    expect(v!.fix_hint).toMatch(/transit|switch/i);
  });

  it('state_mutex violation points to node 0 (holds both mutex tokens)', () => {
    const report = scorer.score(hk3dayBuggy);
    const v = report.deterministic.violations.find(v => v.constraint_id === 'state_mutex');
    expect(v).toBeDefined();
    expect(v!.location.node_index).toBe(0);
    expect(v!.location.field).toBe('state');
  });

  it('no_duplicate_state violation points to node 0→1 (at_hotel persists)', () => {
    const report = scorer.score(hk3dayBuggy);
    const v = report.deterministic.violations.find(v => v.constraint_id === 'no_duplicate_state');
    expect(v).toBeDefined();
    expect(v!.location.node_index).toBe(0);
    expect(v!.location.node_index_end).toBe(1);
  });
});

describe('P0 acceptance 4.5 — deterministic check coverage', () => {
  const contract = loadContract(CONTRACT_PATH);
  const scorer = compileContract(contract);

  it('scorer has 4 deterministic predicates and 2 deterministic rubrics', () => {
    expect(scorer.deterministicPredicateCount).toBe(4);
    expect(scorer.deterministicRubricCount).toBe(2);
  });

  it('deterministic rubric scores include cost_fit and source_trust', () => {
    const report = scorer.score(hk3dayGolden);
    const dims = report.deterministic.rubric_scores.map(r => r.dim);
    expect(dims).toContain('cost_fit');
    expect(dims).toContain('source_trust');
    expect(dims).not.toContain('routing');     // judge,Part 2
    expect(dims).not.toContain('memorability'); // judge,Part 2
    expect(dims).not.toContain('dining_fit');   // judge,Part 2
  });
});
```

- [ ] **Step 2: 跑测试**

```bash
npx vitest run tests/fixtures/acceptance.test.ts
```

Expected: 全部 PASS。如果有 FAIL,根据失败信息修 fixture 或谓词。

- [ ] **Step 3: 跑全部测试**

```bash
npx vitest run
```

Expected: 全部 PASS,无 FAIL。

- [ ] **Step 4: Commit**

```bash
git add tests/fixtures/acceptance.test.ts
git commit -m "test(acceptance): P0 4.1 + 4.5 — 3 bugs caught, deterministic coverage verified"
```

---

## Self-Review

**1. Spec coverage:**

| Spec 节 | Task | 状态 |
|---|---|---|
| §3 Contract v1.0 YAML | Task 3 | ✅ |
| §4.1 3 bug 被抓出 | Task 14 | ✅ |
| §4.4 契约可版本化 | Task 3 (git commit YAML) | ✅ |
| §4.5 确定性覆盖 | Task 11 + Task 14 | ✅ |
| §4.2 分数单调上升 | (Part 2,本 plan 不覆盖) | ⏭️ |
| §4.3 多智能体协同可观测 | (Part 2) | ⏭️ |
| §5 Contract v1.0 schema | Task 2 | ✅ |
| §5 4 条确定性硬约束 | Task 5/6/7/8 | ✅ |
| §5 2 条确定性 rubric | Task 9/10 | ✅ |
| §5 Scorer 编译器 | Task 11 | ✅ |
| §5 q-traveller 黄金工件转换器 | Task 12 | ✅ |
| §5 3 个 bug fixture | Task 13 | ✅ |
| §5 Vitest 测试覆盖 | 每个 Task 都有 | ✅ |
| §5 5 个 Mastra agent + workflow | (Part 2) | ⏭️ |
| §5 3 条 judge rubric prompt | (Part 2) | ⏭️ |
| §5 Critic 提分策略 | (Part 2) | ⏭️ |
| §5 Mastra Studio 可观测 | (Part 2) | ⏭️ |

Part 1 覆盖所有"确定性部分"spec 要求。Part 2 留的接口已在 Task 11 `ScoreReport.judge = null` + `Scorer` 接口里预留。

**2. Placeholder scan:**

- ✅ 无 "TBD/TODO/implement later"(`human_ceiling` 已删,eng-review C1)
- ✅ 每个 step 都有完整代码
- ✅ 每个 test 都有具体 assert

**3. Type consistency:**

- `Artifact` / `ArtifactNode` / `Violation` / `Predicate` — 定义在 Task 4,Task 5-11 全部一致使用 ✅
- `RubricScore` / `DeterministicRubric` — 定义在 Task 9,Task 10/11 一致 ✅
- `ScoreReport` / `DeterministicReport` / `Scorer` — 定义在 Task 11,compiler 一致 ✅
- `CompiledScorer` 扩展 `Scorer` 加 `deterministicPredicateCount/RubricCount` — Task 11 定义,Task 14 测试用 ✅

无类型不一致。

---

## Part 2 接口(本 plan 不实现,记录给 Part 2 plan 用)

Part 2 要做的事(写 Part 2 plan 时的输入):

1. 加 3 个 judge rubric(routing/memorability/dining_fit),用 Vercel AI SDK + OpenRouter→Claude
2. Scorer 升级:judge rubric 的 `mode` 从 'judge'/'proxy+judge' 编译,跑 LLM 调用,填 `ScoreReport.judge`
3. `final_score` 改为 `deterministic * 0.6 + judge * 0.4`
4. 5 个 Mastra agent:Contract-Author / Scorer(包上面 compileContract)/ Judge(fan-out)/ Critic / Curator
5. Mastra workflow 编排:Scorer 派发 Judge sub-agents 并行 → 收齐 → Critic 生成 diff → Curator 检测新颖度
6. Critic 提分策略:硬约束违规生成补丁节点(如插入 transit),judge 低分维度重写节点描述
7. 迭代回路:v1 → score → critic → v2 → score → ... 至少 3 轮,分数单调上升(验收 4.2)
8. Mastra Studio 可观测(验收 4.3)
9. 契约版本化:每次 Curator 提议扩张产生 git commit(验收 4.4)

Part 2 的 Task 1 应该是 "加 Mastra + Vercel AI SDK 依赖",Task 2 是"Judge rubric 接口 + LLM 调用 helper",然后按 agent 一个个加。

---

## Required Outputs (plan-eng-review)

### NOT in scope (P0 Part 1)

- 采集层(fork BigSet / TinyFish API)— P2
- MCP server 封装 — P2
- 缓存层 / 分级延迟 — P3
- Curator 自动契约扩张(P0 只检测+提议,不合并)— P1
- 冻结黄金集回归(P0 不校准 judge)— P1
- champion-challenger A/B — P1
- 情报表探针(第二族)— P1 末尾
- UI / 前端 — P0 是 CLI + Mastra Studio
- 数据库(Convex 等)— P0 是文件系统 + git
- CI/CD 发布流水线 — P0 是 demo 阶段,无发布需求
- Contract YAML 跨版本兼容性测试 — P1(outside-voice T3)
- README/runbook — Part 2 加(outside-voice #17)

### What existing code already solves each sub-problem

| Sub-problem | Existing solution | Plan action |
|---|---|---|
| Contract schema 校验 | zod 库 [Layer 1] | Task 2 用 zod,不重造 |
| YAML 解析 | yaml@2.x 库 [Layer 1] | Task 3 用 yaml 库 |
| 谓词模式(纯函数 artifact→violations) | china-ai-frontline contracts 模式 [Layer 1] | Task 5-8 复用模式 |
| Rubric 加权平均 | q-traveller §8 5 维评分 [Layer 1] | Task 9-10 复用结构 |
| 工件节点 JSON 结构 | q-traveller §6.3 [Layer 1] | Task 12-13 fixture 直接转换 |
| Contract 演化结构 | china-ai-frontline building-blocks v1.0 [Layer 1] | Task 2 schema 复用结构 |

无重复造轮子。所有 sub-problem 都有 Layer 1 参考来源。

### TODOS(P0 完成后创建 TODOS.md 时写入)

- [ ] **P1:** state_mutex 升级到相邻节点互斥 + clearing transition 语义(eng-review A2)
- [ ] **P1:** compileContract 支持 code_predicate.impl 动态加载(isolated-vm 沙箱)(eng-review A3)
- [ ] **P1:** Contract YAML 跨版本兼容性测试(outside-voice T3)
- [ ] **Part 2:** 3 judge rubric + 5 Mastra agent + workflow + 提分迭代 + Mastra Studio 可观测
- [ ] **P2:** 采集层 fork BigSet 或接 CLI
- [ ] **P2:** MCP server 封装
- [ ] **P3:** 缓存层 / 分级延迟(P1 compiler score 无缓存,P3 加增量重算,eng-review P1)
- [ ] **P3:** `no_duplicate_state` Set 构造优化(eng-review P2,P0 节点数 < 10 无问题)
- [ ] **P3:** loadContract beforeAll 共享(eng-review P3,P0 测试 < 10ms 无问题)

### Failure Modes Registry

```
┌─────────────────────────────────────────────────────────────────────┐
│                    Failure Modes (Part 1)                           │
├──────────────────────┬──────────────┬──────────────────────────────┤
│ Failure              │ Severity     │ Handling                     │
├──────────────────────┼──────────────┼──────────────────────────────┤
│ Contract YAML malformed │ Hard      │ loadContract throws,测试捕获 │
│ Contract schema invalid │ Hard      │ zod parse throws,测试捕获    │
│ state_mutex 缺 mutex 字段│ Soft      │ compiler 静默跳过(T1 测试)  │
│ 未知约束 ID           │ Soft        │ compiler 静默跳过(T1 测试)  │
│ judge rubric 误编译   │ Soft        │ compiler 不编译(T1 测试)    │
│ 节点缺 state 字段     │ Soft        │ Array.isArray 防御,返回 []  │
│ 节点缺 duration_min   │ Soft        │ typeof 检查,跳过            │
│ 节点缺 cost           │ Soft        │ typeof 检查,跳过            │
│ artifact.nodes 空     │ Soft        │ 所有谓词返回 [],rubric 返回 │
│                      │             │ neutral/0.0                  │
│ Empty artifact (nodes=[])│ Soft     │ 谓词返回 [],rubric 返回     │
│                      │             │ source_trust=0, cost_fit=0.5│
└──────────────────────┴──────────────┴──────────────────────────────┘
```

### Parallelization

```
┌─────────────────────────────────────────────────────────────────┐
│              Task Dependency Graph (Part 1)                     │
│                                                                 │
│  Task 1 (scaffold)                                              │
│       │                                                         │
│       ├──→ Task 2 (schema) ──→ Task 3 (validate+YAML)           │
│       │                                │                        │
│       │                                ├──→ Task 4 (types)      │
│       │                                │       │                │
│       │                                │       ├──→ Task 5 (continuity) ─┐
│       │                                │       ├──→ Task 6 (state_mutex)─┤
│       │                                │       ├──→ Task 7 (time_budget)─┤
│       │                                │       └──→ Task 8 (no_dup_state)┤
│       │                                │                                │
│       │                                │       Task 9 (cost_fit) ────────┤
│       │                                │       Task 10 (source_trust)───┤
│       │                                │                                │
│       │                                └──→ Task 11 (compiler) ←────────┘
│       │                                           │                    │
│       │                                           ├──→ Task 12 (golden)│
│       │                                           ├──→ Task 13 (buggy) │
│       │                                           └──→ Task 14 (accept)│
│                                                                 │
│  Parallelizable batches (after deps met):                       │
│  - Batch A: Task 5,6,7,8 (predicates,独立)                      │
│  - Batch B: Task 9,10 (rubrics,独立)                            │
│  - Batch C: Task 12,13 (fixtures,独立,依赖 Task 4 types)       │
└─────────────────────────────────────────────────────────────────┘
```

**并行执行建议:**
- Task 1→2→3→4 严格顺序(依赖链)
- Task 5/6/7/8 可并行(都只依赖 Task 4)
- Task 9/10 可并行(依赖 Task 4 + 自己的 types.ts)
- Task 12/13 可并行(依赖 Task 4)
- Task 11 必须等 Task 5-10 全部完成
- Task 14 必须最后(依赖 Task 11/12/13)

### Implementation Tasks Summary

| Task | 文件 | 测试数 | 依赖 | 并行批次 |
|---|---|---|---|---|
| 1 | scaffold | 0 | - | solo |
| 2 | schema.ts | 3 | 1 | solo |
| 3 | validate.ts + YAML | 3 | 2 | solo |
| 4 | types.ts | 0 (typecheck) | 3 | solo |
| 5 | continuity.ts | 5 | 4 | Batch A |
| 6 | state_mutex.ts | 4 | 4 | Batch A |
| 7 | time_budget.ts | 5 | 4 | Batch A |
| 8 | no_duplicate_state.ts | 7 | 4 | Batch A |
| 9 | cost_fit.ts + rubric/types.ts | 5 | 4 | Batch B |
| 10 | source_trust.ts | 5 | 4 | Batch B |
| 11 | compiler.ts + scorer/types.ts | 5 | 5-10 | solo |
| 12 | hk-3day-golden.ts | 0 (typecheck) | 4 | Batch C |
| 13 | hk-3day-buggy.ts | 0 (typecheck) | 4 | Batch C |
| 14 | acceptance.test.ts | 12 | 11,12,13 | solo |
| **总** | | **55 测试** | | |

---

## GSTACK REVIEW REPORT

**Plan:** `docs/superpowers/plans/2026-06-23-crucible-p0-mvp.md` (Part 1 of 2)
**Branch:** crucible/dev
**Review date:** 2026-06-24
**Reviewer:** Claude (plan-eng-review skill) + Claude subagent (outside voice)

### Runs / Status / Findings

| Run | Skill | Status | Findings | Fixed |
|---|---|---|---|---|
| 1 | plan-eng-review Step 0 (scope challenge) | ✅ DONE | D1 (buggy fixture 设计不真实), D2 (penalty 0.15 任意), D3 (Part 1/2 切分) | D1=A (重写 fixture), D2=A (维持 0.15), D3=A (维持切分) |
| 2 | plan-eng-review Section 1 (Architecture) | ✅ DONE | A1 (continuity 注释误导), A2 (state_mutex P0 能力 < PRD 语义), A3 (compiler 硬编码非真可执行) | A1=A (改注释), A2=A (标注技术债), A3=A (标注技术债) |
| 3 | plan-eng-review Section 2 (Code Quality) | ✅ DONE | C1 (human_ceiling TBD placeholder), C2 (PredicateFactory dead code), C3 (rubric 缺失数据默认不一致) | C1=A (删 TBD), C2=A (删 factory), C3=A (加约定注释) |
| 4 | plan-eng-review Section 3 (Tests) | ✅ DONE | T1 (compiler 缺错误路径测试), T2 (验收缺 fix_hint 断言), T3 (Contract 兼容性测试) | T1=A (加 3 测试), T2=A (加 4 断言), T3=deferred P1 |
| 5 | plan-eng-review Section 4 (Performance) | ✅ DONE | P1 (compiler 无缓存), P2 (Set 构造开销), P3 (loadContract 文件 IO) | 全 deferred 到 Part 2/P3 (P0 无性能问题) |
| 6 | Outside Voice (Claude subagent) | ✅ DONE | #15 (stale "2 tests"), #25 (parseContractYaml dead export), #12 (makeStateMutex tuple 类型), #11/#7/#24 (文档类) | #15=A (改 5 tests), #25=A (删 dead export), #12=A (改 string[]), #11/#7/#24 标注 |

### VERDICT

**PASS with deferred tech debt.**

Plan 可执行。3 个 bug 验收测试会通过(manual trace 确认:continuity=1 + state_mutex=1 + no_duplicate_state=1 = 3 hard violations)。Part 1/Part 2 切分干净(`ScoreReport.judge=null` + `Scorer` 接口预留)。55 个测试覆盖 happy path + 错误路径 + 验收契约。

**Deferred tech debt(写入 TODOS.md,P0 完成后):**
- A2: state_mutex 相邻节点互斥(P1)
- A3: compiler code_predicate.impl 动态加载(P1)
- T3: Contract 跨版本兼容性测试(P1)
- P1/P2/P3: 性能优化(Part 2/P3)
- #11/#7/#24: 文档/约定类(outside-voice acceptable)

**Outside voice score:** 7/10 (Claude subagent)。扣分项已全部修复(#15/#25/#12)或标注(#11/#7/#24)。

**CODEX:** 不可用(codex 不在 PATH,dual-voice 降级为 Claude subagent-only)。

**CROSS-MODEL:** N/A(codex 不可用,无 cross-model consensus)。

NO UNRESOLVED DECISIONS
