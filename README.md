# Crucible — 契约驱动合成引擎

> P3.5 工程加固完成(架构决议落地 + SQLite 持久化 + 新颖度 v2 + 黄金集治理)
> Branch: `crucible/dev` | Worktree: `D:\Apps\traveller.crucible-dev`

## 一句话立住

一群智能体不靠聊天、而靠一份可执行契约协同,自动发现缺陷、自动提分。

## P3.5 验收(全达成)

| 阶段 | 验收 | 状态 |
|---|---|---|
| P0 | 三个真实 bug 被确定性 scorer 抓出 | ✅ |
| P1 | judge 校准 + Kendall τ + 黄金集 | ✅ |
| P2 | 沙箱 + 采集层 + MCP server + UI 可视化 | ✅ |
| P3 | 契约自演化 + A/B + 缓存层 + BigSet 生产级 + DSL 草案 | ✅ |
| P3.5 §2.1 | Mastra v1.x 适配层 + BigSet 永久 adapter 决议 | ✅ |
| P3.5 §2.2 | SQLite 持久化(4 表 + migration) | ✅ |
| P3.5 §2.3 | 新颖度 v2(schema + distribution 检测器) | ✅ |
| P3.5 §2.4 | 黄金集治理(扩容 ≥ 20 + 审计脚本) | ✅ |
| P3.5 §2.5 | demo/mcp npm scripts + 移除未用 dep | ✅ |

## 快速开始

```bash
# 跑全部测试
npm test

# 类型检查
npm run typecheck

# 生成五段式 demo HTML(路演用)
npm run demo:html

# 启动 MCP server(JSON-RPC over stdio)
npm run mcp:serve

# 黄金集审计(分布统计 + 覆盖率矩阵)
npm run audit:golden

# 真实 LLM judge(有 API key 时)
OPENROUTER_API_KEY=sk-... npx tsx src/demo.ts
```

## 架构(P3.5: Mastra 适配层 + 自研编排,不 fork BigSet)

```
┌─────────────────────────────────────────────────────────┐
│                    Crucible Workflow                     │
│                                                          │
│  v1(buggy)                                              │
│    │                                                     │
│    ▼                                                     │
│  ┌─────────┐   ┌─────────┐   ┌─────────┐   ┌─────────┐ │
│  │ Scorer  │──▶│ Critic  │──▶│ Apply   │──▶│ Curator │ │
│  │ (det+   │   │ (patch  │   │ Patches │   │(novelty │ │
│  │  judge) │   │  gen)   │   │         │   │  v2)    │ │
│  └────┬────┘   └─────────┘   └─────────┘   └────┬────┘ │
│       │              │                            │      │
│       │         LRU cache(P3)               novelty v2  │
│       │                                         │       │
│       ▼                                         ▼       │
│  ┌──────────────────┐   ┌─────────────────────────┐    │
│  │ SQLite 持久化(P3.5)│   │ Contract-Author (LLM)  │    │
│  │ contracts/       │   │ → Human Gate → A/B      │    │
│  │ score_runs/      │   │ → promote/retain        │    │
│  │ ab_results/      │   └─────────────────────────┘    │
│  │ proposals/       │                                  │
│  └──────────────────┘                                  │
└─────────────────────────────────────────────────────────┘

final_score = deterministic_score * 0.6 + judge_overall * 0.4
```

## 核心组件

| 组件 | 文件 | 职责 |
|---|---|---|
| Contract v1.0 | `contracts/travel-sequence-v1.yaml` | 好计划的可执行定义(字段+约束+rubric) |
| Schema | `src/contract/schema.ts` | zod 校验,权重和=1.0 |
| Compiler | `src/contract/compiler.ts` | Contract → 可执行 Scorer |
| 4 谓词 | `src/predicates/` | continuity/state_mutex/time_budget/no_duplicate_state |
| 确定性 rubric | `src/rubric/cost_fit.ts` + `source_trust.ts` | 无 LLM |
| 3 judge rubric | `src/rubric/*.judge.ts` + `fanout.ts` | LLM 评估(routing/memorability/dining_fit) |
| JudgeAugmentedScorer | `src/scorer/augmented.ts` | 包装确定性 + judge |
| Critic | `src/agents/critic.ts` | 违规→确定性 patch |
| Curator v2 | `src/curator/novelty_v2.ts` | 新颖度检测(schema + distribution + set-diff) |
| Workflow | `src/workflow/crucible.ts` | 3 轮迭代回路 |
| **Mastra 适配层** | `src/agents/mastra-adapter.ts` | SimpleAgent → Mastra Agent facade(P3.5 §2.1.1) |
| **SQLite 持久化** | `src/persistence/` | contracts/score_runs/ab_results/proposals(P3.5 §2.2) |
| **扩容黄金集** | `src/fixtures/golden-set-expanded.ts` | ≥ 20 工件 + 覆盖率矩阵(P3.5 §2.4) |
| Fixtures | `src/fixtures/` | hk-3day-golden + buggy + intel-table |

## Mastra 适配层(P3.5 §2.1.1)

P0 降级为 SimpleAgent(Mastra 0.1.x peer dep 缺失)。P3.5 调研发现 `@mastra/core` v1.47.0
peer dep 仅 zod,`Agent` 从 `@mastra/core/agent` 导出。采用**适配层路径**:

- `createMastraAgent(name, instructions)` 返回结构兼容 `SimpleAgent` 的 facade
- 默认(`CRUCIBLE_USE_MASTRA` 未设): 等同 SimpleAgent,P3 行为零变化
- `CRUCIBLE_USE_MASTRA=1`: facade 挂载 `getMastraAgent(model)`,获得真实 Mastra Agent
  (orchestration/memory/streaming)
- 决议见 `docs/decisions/mastra-p3-evaluation.md` (v2)

## 降级方案

| 场景 | 降级 |
|---|---|
| 无 OPENROUTER_API_KEY | judge 返回 neutral 0.5,workflow 仍跑通 |
| Mastra 未启用 | 用 SimpleAgent(纯 TS),`CRUCIBLE_USE_MASTRA=1` 启用适配层 |
| git commit 失败 | proposal 文件仍写 |
| LLM 返回非数字 | parseJudgeScore 返回 0.5 |
| better-sqlite3 不可用 | 持久化层降级到 :memory:(测试默认) |

## 设计文档

- Spec: `docs/superpowers/specs/crucible-p{0,1,2,3,3.5}-spec.md`
- 决议: `docs/decisions/mastra-p3-evaluation.md` (v2) + `bigset-fork-evaluation.md`
- 治理: `docs/governance/frozen-golden-set.md`
- QA: `docs/qa/qa-report-crucible-p{0,1,2,3,3.5}-*.md`
- DSL: `docs/dsl-standard/crucible-dsl-v1.md`
- Context checkpoints: `~/.gstack/projects/traveller.crucible-dev/checkpoints/`

## License

AGPL-3.0(PRD v1.2 §3 决议;P3.5 §2.1.2 永久走 adapter 模式不 fork BigSet,
引擎可独立 MIT/AGPL 二选一,ToB 靠"引擎开源 / 契约私有"分层)

