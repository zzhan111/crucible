# Crucible P0 MVP Spec

> 输入给 `/writing-plans`,产出 `docs/superpowers/plans/2026-06-23-crucible-p0-mvp.md`。
> 本 spec 收敛自:PRD v1.2 + 4 份种子勘察 + Approach D 决议。
> 详细上下文见 checkpoint: `~/.gstack/projects/traveller.feature-beta/checkpoints/20260623-152649-crucible-p0-context.md`

---

## 1. Goal

在 `crucible/dev` worktree 内,用 Mastra + TypeScript 跑通 Crucible P0 MVP:**一组智能体围绕一份可执行契约协同,自动发现 3 个真实旅游计划缺陷,自动提分,分数从 v1 单调上升到 vN**。这是多智能体协作赛道的路演 demo 主体。

## 2. Architecture (Approach D — Mastra-native, 不 fork)

- **不 fork BigSet**。Mastra 作为 npm 依赖直接用。
- **不建采集层**。P0 输入用 q-traveller 现成数据(香港 3 天黄金计划 JSON + 3 个真实 bug 场景)。
- **5 个 Mastra agent** 围绕一份 Contract YAML 协同:
  - Contract-Author Agent — 起草/修订契约
  - Scorer Agent — 编译契约为确定性检查 + 派发 judge
  - Judge sub-agents — 按软维度并行打分(fan-out)
  - Critic Agent — 诊断 + 提分 diff
  - Curator Agent — 新颖度检测 + 契约扩张候选(本 P0 只做检测,不做自动扩张)
- **Human Gate** 在 P0 是 CLI 交互(不自动扩张契约),后续阶段才做 HITL UI。
- **共享协调基质** = Contract YAML 文件 + 版本化 git diff。所有 agent 读写同一文件,交接可验证。
- **技术栈**: TypeScript + Node.js + Mastra + Vercel AI SDK + OpenRouter→Claude + Vitest + biawesome-yaml。

## 3. Contract v1.0 (P0 子集,继承 q-traveller §4/§8 + china-ai-frontline building-blocks 结构)

```yaml
artifact_family: sequence
fields:
  - {name: time_block,    type: string,  required: true}   # "13:10-13:40"
  - {name: action,        type: string,  required: true}   # "坐 9 号巴士"
  - {name: route,         type: string,  required: false}  # "筲箕湾站 A2 → 巴士总站"
  - {name: duration_min,  type: integer, required: true}
  - {name: node_type,     type: enum,    required: true, values: [hard, transit, switch, core_experience, checkin, dining, buffer]}
  - {name: elasticity,    type: enum,    required: true, values: [non_compressible, compressible, replaceable]}
  - {name: cost,          type: number,  required: false}
  - {name: source,        type: string,  required: false}
  - {name: source_trust,  type: number,  required: false}  # 0.0-1.0
  - {name: state,         type: string[], required: false} # ["luggage_drop", "depart_from_hotel", ...]
hard_constraints:
  - id: continuity
    type: declarative
    rule: "every adjacent pair of nodes must have a transit or switch between them"
  - id: state_mutex
    type: declarative
    mutex: [luggage_drop, depart_from_hotel]
  - id: time_budget
    type: declarative
    rule: "sum(duration_min) for each day ≤ daily_available_minutes"
  - id: no_duplicate_state
    type: declarative
    rule: "no state token appears in two consecutive nodes without a clearing transition"
rubric:
  - {dim: routing,         weight: 0.25, mode: proxy+judge}
  - {dim: memorability,    weight: 0.25, mode: judge}
  - {dim: dining_fit,      weight: 0.15, mode: judge}
  - {dim: cost_fit,        weight: 0.15, mode: deterministic}
  - {dim: source_trust,    weight: 0.20, mode: deterministic}
calibration:
  frozen_golden_set: golden/hk-3day-v1.jsonl
  metric: kendall_tau
  human_ceiling: TBD  # P0 不测,留 P1
```

## 4. 验收标准 (P0 Done Definition)

**4.1 三个真实 bug 必须被 Scorer 自动抓出**(来自 q-traveller §7 香港重排场景):
1. `continuity` 违规 — 早餐后节点直接跳到景点,中间缺 transit/switch(对应"早餐后→地铁缺切换")
2. `state_mutex` 违规 — 寄存行李节点与从酒店出发节点同时持有互斥 state(对应"寄存行李与从酒店出发互斥重复")
3. `no_duplicate_state` 违规 — 同一 state token 连续两节点出现无清除(对应"状态重复")

**4.2 分数单调上升**:Critic 基于打分报告生成 diff → 工件 v2 → 重打分 → 分数必须高于 v1。迭代至少 3 轮(v1→v2→v3),每轮分数严格递增。

**4.3 多智能体协同可观测**:Mastra Studio(:4111)能看到 5 个 agent 的 fan-out/fan-in,每个 agent 的输入/输出可点开查看。日志里能看到"Scorer 派发 3 个 Judge sub-agent 并行 → 收齐 → 合分"。

**4.4 契约可版本化**:Contract YAML 在 git 里,每次 Critic 触发 Curator 提议扩张时,产生一个 commit(即使 P0 不自动合并,也要留下提议 diff)。

**4.5 确定性检查覆盖**:continuity / state_mutex / time_budget / no_duplicate_state / cost_fit / source_trust 六项必须走确定性代码,不调 LLM。只有 routing / memorability / dining_fit 三项调 judge。

## 5. Scope (P0 必做)

- Contract v1.0 YAML schema + TypeScript 类型 + 校验器
- 4 条确定性硬约束谓词(continuity/state_mutex/time_budget/no_duplicate_state)+ 2 条确定性 rubric(cost_fit/source_trust)
- 3 条 judge rubric prompt(routing/memorability/dining_fit)
- Scorer 编译器:Contract YAML → 可执行 Scorer 函数
- 5 个 Mastra agent + 1 个 workflow 编排
- q-traveller 香港 3 天黄金计划 → 工件 JSON 转换器(把 q-traveller §6.3 节点 JSON 转成 Contract fields)
- 3 个 bug 注入的工件 fixture(故意违规的 v1 工件)
- Critic 提分策略:针对硬约束违规生成补丁节点,针对 judge 低分维度重写描述
- Mastra Studio 可观测性
- Vitest 测试覆盖每个 agent + 每条约束

## 6. Out of Scope (P0 不做,留后续阶段)

- 采集层(fork BigSet / TinyFish API)— P2
- MCP server 封装 — P2
- 缓存层 / 分级延迟 — P3
- Curator 自动契约扩张(P0 只检测+提议,不合并)— P1
- 冻结黄金集回归(P0 不校准 judge)— P1
- champion-challenger A/B — P1
- 情报表探针(第二族)— P1 末尾
- UI / 前端 — P0 是 CLI + Mastra Studio
- 数据库(Convex 等)— P0 是文件系统 + git

## 7. 关键文件结构(plan 应遵循)

```
crucible-dev/
├── docs/superpowers/
│   ├── specs/crucible-p0-spec.md          # 本文件
│   └── plans/2026-06-23-crucible-p0-mvp.md # /writing-plans 产出
├── src/
│   ├── contract/
│   │   ├── schema.ts                       # Contract v1.0 TypeScript 类型
│   │   ├── validate.ts                     # YAML 校验器
│   │   └── compiler.ts                     # Contract → Scorer 编译器
│   ├── predicates/
│   │   ├── continuity.ts
│   │   ├── state_mutex.ts
│   │   ├── time_budget.ts
│   │   └── no_duplicate_state.ts
│   ├── rubric/
│   │   ├── cost_fit.ts                     # deterministic
│   │   ├── source_trust.ts                 # deterministic
│   │   ├── routing.judge.ts                # LLM judge + proxy
│   │   ├── memorability.judge.ts           # LLM judge
│   │   └── dining_fit.judge.ts             # LLM judge
│   ├── agents/
│   │   ├── contract-author.ts
│   │   ├── scorer.ts
│   │   ├── judge.ts                         # fan-out sub-agent
│   │   ├── critic.ts
│   │   └── curator.ts
│   ├── workflow/
│   │   └── crucible.ts                      # Mastra workflow 编排
│   └── fixtures/
│       ├── hk-3day-golden.json              # q-traveller 转换的黄金工件
│       └── hk-3day-buggy-v1.json            # 注入 3 bug 的工件
├── contracts/
│   └── travel-sequence-v1.yaml              # Contract v1.0 YAML
├── golden/
│   └── hk-3day-v1.jsonl                     # 冻结黄金集(P0 占位,P1 才用)
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

## 8. 风险与对策 (P0 特化)

| 风险 | 对策 |
|---|---|
| OpenRouter/Claude API key 缺失 | .env 加 `OPENROUTER_API_KEY`;无 key 时 judge 降级为返回中位分 + 警告日志,P0 仍能跑通确定性部分 |
| Mastra Studio 在 Windows 跑不起来 | P0 不强依赖 Studio;日志里打 agent DAG,P0 验收 4.3 用日志替代 |
| 3 个 bug fixture 写不出来 | q-traveller §7 已给真实场景描述,转换成 JSON 节点序列即可 |
| Judge 分数不稳导致不单调上升 | 确定性违规修掉后分数必然上升(硬约束违规扣分重);judge 维度只做"不降分"保证 |
| git path 在 WSL/Windows 混乱 | 所有 gstack 调用走 wrapper 脚本显式 export env(见 checkpoint Notes) |

## 9. 成功的演示场景

路演 demo 三段式(对应 q-traveller §7):
1. **展示契约**:打开 `contracts/travel-sequence-v1.yaml`,解释这是"好计划的可执行定义"
2. **跑分 + 抓 bug**:喂 `hk-3day-buggy-v1.json` 进 workflow,Scorer 抓出 3 个违规,Critic 生成 diff
3. **提分迭代**:v1→v2→v3,分数曲线上升,最后展示 git log 里 Contract 的演化 commit

一句话立住:**"一群智能体不靠聊天、而靠一份可执行契约协同,自动发现缺陷、自动提分。"**
