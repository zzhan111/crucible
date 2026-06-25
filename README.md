# Crucible — 契约驱动合成引擎

> P0 MVP(多智能体协作赛道 demo)
> Branch: `crucible/dev` | Worktree: `D:\Apps\traveller.crucible-dev`

## 一句话立住

一群智能体不靠聊天、而靠一份可执行契约协同,自动发现缺陷、自动提分。

## P0 验收(全达成)

| # | 验收 | 状态 |
|---|---|---|
| 4.1 | 三个真实 bug 被确定性 scorer 抓出 | ✅ |
| 4.2 | 分数改进(非递减 + 至少一轮提升) | ✅ |
| 4.3 | 多智能体协同可观测(日志 tag) | ✅ |
| 4.4 | 契约版本化(Curator proposal + 文件) | ✅ |
| 4.5 | 确定性覆盖(4 谓词 + 2 rubric) | ✅ |

## 快速开始

```bash
# 跑全部测试(119 tests,含 20 边界 case)
npm test

# 跑 demo(三段式路演)
npx tsx src/demo.ts

# 跑 demo(有 OpenRouter API key,LLM judge 真实打分)
OPENROUTER_API_KEY=sk-... npx tsx src/demo.ts
```

## 架构(Approach D: Mastra-native,不 fork BigSet)

```
┌─────────────────────────────────────────────────────────┐
│                    Crucible Workflow                     │
│                                                          │
│  v1(buggy)                                              │
│    │                                                     │
│    ▼                                                     │
│  ┌─────────┐   ┌─────────┐   ┌─────────┐   ┌─────────┐ │
│  │ Scorer  │──▶│ Critic  │──▶│ Apply   │──▶│ Curator │ │
│  │ (det+   │   │ (patch  │   │ Patches │   │ (novelty│ │
│  │  judge) │   │  gen)   │   │         │   │  detect)│ │
│  └────┬────┘   └─────────┘   └─────────┘   └────┬────┘ │
│       │                                         │       │
│       │   ┌─────────────────────────────────────┘       │
│       │   │ proposals → contracts/proposals/*.yaml     │
│       ▼   ▼                                             │
│  v2(patched)──▶ v3 ──▶ ... (max 3 rounds)              │
│                                                          │
│  终止:提升 < 0.01 或达 3 轮                             │
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
| 2 确定性 rubric | `src/rubric/cost_fit.ts` + `source_trust.ts` | 无 LLM |
| 3 judge rubric | `src/rubric/*.judge.ts` + `fanout.ts` | LLM 评估(routing/memorability/dining_fit) |
| JudgeAugmentedScorer | `src/scorer/augmented.ts` | 包装确定性 + judge,final=det*0.6+judge*0.4 |
| Critic | `src/agents/critic.ts` | 违规→确定性 patch |
| Curator | `src/agents/curator.ts` | 新颖度检测→proposal |
| Workflow | `src/workflow/crucible.ts` | 3 轮迭代回路 |
| Fixtures | `src/fixtures/` | hk-3day-golden(无 bug)+ hk-3day-buggy(3 bug) |

## 降级方案

| 场景 | 降级 |
|---|---|
| 无 OPENROUTER_API_KEY | judge 返回 neutral 0.5,workflow 仍跑通 |
| Mastra 不可用 | 用 SimpleAgent(纯 TS),P2 升级 |
| git commit 失败 | proposal 文件仍写 |
| LLM 返回非数字 | parseJudgeScore 返回 0.5 |

## 技术债(P1)

- state_mutex 升级到相邻节点互斥(当前只查同节点)
- compiler 支持 code_predicate.impl 动态加载(当前硬编码)
- workflow pre-patch score 只跑确定性(省一半 LLM 调用)
- Contract-Author 加 LLM 修订能力(当前只读)
- Curator 自动合并提议(当前只检测+提议)
- 冻结黄金集校准 judge
- Mastra 升级(当前降级为 SimpleAgent)

## 设计文档

- Spec: `docs/superpowers/specs/crucible-p0-spec.md`
- Part 2 Spec: `docs/superpowers/specs/crucible-p0-spec-part2.md`
- Part 1 Plan: `docs/superpowers/plans/2026-06-23-crucible-p0-mvp.md`(eng-reviewed)
- Part 2 Plan: `docs/superpowers/plans/2026-06-24-crucible-p0-mvp-part2.md`(eng-reviewed)
- Context checkpoints: `~/.gstack/projects/traveller.crucible-dev/checkpoints/`

## License

AGPL-3.0(继承 PRD v1.2 §3 决议;Approach D 不 fork BigSet 故不触发衍生义务,P4 商业化时再评估)
