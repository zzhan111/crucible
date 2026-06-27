# Decision: BigSet Fork 评估 — 永久走 Adapter 模式 (P3.5 §2.1.2)

> 关闭 OQ-21 (upstream sync 策略)。
> 关闭 P0→P2→P3 反复延期的"真实 fork BigSet"技术债。

## 状态:ADOPTED — 永久 Adapter 模式,不 fork

## 背景:PRD v1.2 的 fork 诉求

PRD v1.2 §3 "架构翻面:从 API 外挂到 Fork 改建" 提出 **pull BigSet 源码、把契约智能体
织进 BigSet 的 Mastra 编排**,理由三连:
1. 极客赛道要"多智能体协同"技术深度 → fork 才能同栈协作
2. AGPL fork → 整体成衍生作品 → 锁定 on-prem ToB(与 OQ-11 一致)
3. 把 BigSet 当黑盒 API 调,看不见也改不动它内部智能体编排

P0 spec §15 明确"不 fork BigSet,Mastra 作为 npm 依赖直接用";P2 spec §2.2 "工程量过大,
真实 fork 留 P3";P3 再次延期。P3.5 spec §2.1.2 给出门槛:**fork 工程量 ≤ 2 天 + 不污染主仓
→ fork;否则 → 永久 adapter 决议**。

## 评估结论:不满足门槛,走 adapter 模式

### 1. 仓库不可达

Crucible 仓内**无任何记录的 BigSet 仓库 URL**。PRD 把 BigSet 描述为外部"experimental"
项目(Search/Fetch/Browser + schema 推断 + dedup + verification + cron 全链路),
但 docs/specs/decisions 中无 clone 来源。无源可 pull,fork 工程第一步即不可执行。

### 2. 技术栈严重不匹配

PRD 描述 BigSet 是 **Convex + Mastra + Next 全栈**。Crucible P0-P3 是**纯 TypeScript CLI
引擎**(vitest + ai SDK + zod + yaml,无 Convex/Next/前端运行时)。fork 一个全栈项目进 CLI
引擎意味着:
- 拖入 Convex 后端运行时(Crucible 无后端)
- 拖入 Next.js 前端层(Crucible 的 UI 是 demo-html 单文件)
- Convex/Mastra 全栈的 schema/dedup/cron 逻辑与 Crucible 的"契约打分自演化"核心**正交**
  — Crucible 需要的是 BigSet **输出的表**,不是 BigSet 的**采集链路本身**

工程量远超 2 天门槛,且会严重污染主仓(引入无关全栈依赖)。

### 3. PRD fork 诉求的三连理由已被 P0-P3 实现化解

| PRD 理由 | P3.5 化解 |
|---------|---------|
| fork 才能多智能体协同 | P3.5 §2.1.1 已接回 Mastra v1.47,`createAgentRegistryWithMastra()` + `getMastraAgent(model)` 提供真实 Mastra Agent 实例,orchestration/memory/streaming 可用 — **无需 fork 即得 Mastra 编排** |
| AGPL fork 锁定 ToB | Crucible 核心引擎可独立 MIT/AGPL 二选一;ToB 锁定靠**契约私有分层**(引擎开源 / 契约私有),不依赖 fork BigSet |
| 黑盒 API 看不见编排 | adapter 模式下 BigSet 是数据源(输入表),Crucible 拥有**自己**的完整 agent 编排(contract-author/judge/scorer/curator/critic),Crucible 的编排本就是自研,不需要"看见 BigSet 的编排" |

PRD fork 诉求的本质是"比赛叙事需要多智能体协同" — 该叙事由 **Mastra 适配层(P3.5 §2.1.1)**满足,
不依赖 fork。

### 4. upstream sync 负担(OQ-21)在 adapter 模式下为零

fork 一个 experimental 全栈项目 = 持续承担 upstream 同步、breaking change、
experimental 不稳定性的维护税。adapter 模式下,BigSet 只是 `bigset-adapter.ts` 一个
数据适配器接口(`validate` + `adapt`),upstream 变化只需改适配器,零同步负担。

## 落地物

- 本决议文档(关闭 OQ-21 + 永久 adapter)
- `src/collection/bigset-adapter.ts` 保持 adapter 接口形态(P2 已实现,无需改动)
- `src/upstream/` 目录**不创建**(fork 路径放弃)

## 不做(明确放弃)

- 不 pull/fork BigSet 源码
- 不把契约智能体织进 BigSet 的 Mastra 编排(Crucible 用自己的 Mastra 适配层,见 §2.1.1)
- 不引入 Convex/Next 全栈依赖

## 关闭的 Open Questions

- **OQ-21 (upstream sync 策略)**: adapter 模式下无 upstream 代码,零 sync 负担,关闭。
- **OQ-17 (替换 BigSet 数据采集后端)**: adapter 接口已隔离采集后端;若未来换数据源,
  只需新写一个 `ArtifactAdapter`,不动核心引擎。维持"待议"但已降为低优先。

## 与 PRD v1.2 的关系

本决议**不否定** PRD v1.2 的产品定位(契约驱动合成 / ToB on-prem / 多智能体协同)。
它否定的是**实现手段**:用 adapter + 自研 Mastra 适配层达到 PRD 想要的协同与编排能力,
而非 fork 一个 experimental 全栈仓库。这是 P0-P3 实践验证后的工程务实选择 —
独立引擎已跑通 306 tests,无需为叙事拖入不可控的上游。
