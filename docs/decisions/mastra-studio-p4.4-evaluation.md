# Decision: P4.4 Mastra Studio 集成 — 降级为评估,推迟

> 评估结论:**P4.4 降级,不写代码。** Studio 完整接入需网络装 CLI + 迁 LLM 调用路径到 Agent.generate()(大改),当前环境与 ToB 落地时机均不满足。推迟到有真 ToB 客户 + 稳定网络环境再做。

## 状态:DEFERRED (评估文档,无代码)

## 背景

P4.4 计划项为"Mastra Studio 可观测集成"。P3.5(`docs/decisions/mastra-p3-evaluation.md` v2)已落适配层:
`@mastra/core@1.47.0` 通过 `src/agents/mastra-adapter.ts` 接回,`CRUCIBLE_USE_MASTRA=1` 时构造真 `Agent` 实例。
但 P3.5 决议明确"不引入 Mastra Server / Studio 运行时(适配层就位即可,P4 视 ToB 需求决定)"——本文档即 P4 的视需求决定结果。

## 调研证据(P4.4 探索阶段)

### 1. Studio CLI 未安装,需网络

```
node_modules/@mastra/ → 仅 core + schema-compat
无 @mastra/studio / @mastra/cli / @mastra/server 包
node_modules/.bin/ 无 mastra 二进制
```

`@mastra/core` 本身**不**打包 Studio UI 或 dev-server。Studio 是独立 dev-tool(官方 `npx mastra dev` 运行时从网络拉 `@mastra/studio` 风格 CLI)。本机为离线/受限网络 Windows 环境,装 CLI 有失败风险。

### 2. `@mastra/core` 内置 observability / server API(在树内,无需网络)

`@mastra/core` 的 exports map 含:
- `./observability` → `Observability` 类 + OpenTelemetry 风格 exporter + no-op 默认
- `./server` → `MastraServerBase` / `registerApiRoute` / `StudioConfig` 类型
- `Mastra` 类构造接受 `{ agents, observability?, server?, studio? }`

即:**可观测基础设施在树内**,缺的是 Studio UI 前端 + 把 agent 接进 `Mastra` 容器。

### 3. 当前 adapter 不支持 Studio 观测(关键阻塞)

`src/agents/mastra-adapter.ts` 的 `createMastraAgent` 返回的是 **detached Agent facade**:
- 仅在 `CRUCIBLE_USE_MASTRA=1` 时 `getMastraAgent()` 惰性构造单个 `Agent` 实例
- **不**构造 `new Mastra({ agents, observability, server, studio })` 容器
- **不**注册 server,不配 observability
- 因此没有 Mastra 运行时图供 Studio 内省

### 4. LLM 调用路径不经 Agent.generate()

Crucible 的 LLM 调用走 `ai` SDK(`src/agents/judge.ts` 的 `fanoutJudges` / `callLLM`),
**不**经过 Mastra `Agent.generate()` / `stream()`。Studio 观测的是 Mastra 编排的 agent run/trace;
当前 agent 是纯 `{name, instructions}` 容器,LLM 在 Agent 之外调用 → **即使有运行的 server,Studio 也看不到任何 trace**。

P3.5 决议原文:"不全量替换 agent LLM 调用路径(留 P4,**需 Mastra Studio 可观测端点配合**)"
——即 LLM 路径迁移是 Studio 有意义的前置条件。

## 完整接入所需(三步,均非平凡)

1. **装 Studio CLI** — `@mastra/studio` 风格包,需网络(本机离线风险)
2. **建 `new Mastra({ agents: {contractAuthor, scorer, judge}, observability, server, studio })` 容器** — 新增 wiring,注册 3 个 agent + 配 exporter + server config
3. **迁 LLM 调用路径到 `Agent.generate()`** — `fanoutJudges`/`callLLM` 改走 Agent 实例(大改,影响 P0-P3 全部 LLM 调用点 + 校准)

## 决议

**P4.4 降级为评估文档,不写代码。** 理由:

1. **网络风险**:Studio CLI 需网络安装,本机为受限 Windows 环境(npm install 历史超时)。
2. **重构成本**:步骤 3(LLM 路径迁 Agent.generate())是大改,影响 P0-P3 校准基线,无 ToB 客户驱动不值得冒回归风险。
3. **无落地驱动**:Studio 是 dev-tool,价值在开发期观测;当前无真 ToB 客户 on-prem 部署需要运维观测面。
4. **基础设施已就位**:`@mastra/core` 的 `./observability` API 在树内,是未来接入点 — 推迟不丢失能力,只是不接 UI。

## 推迟条件(何时再做)

满足以下任一时重开 P4.4:
- 有真 ToB 客户 on-prem 部署,需要运行期 agent 可观测面
- 稳定网络环境,Studio CLI 可靠安装
- LLM 路径迁移已有独立 spec 与校准回归保护

## 未来接入路径(备忘)

- 接入点:`@mastra/core` 的 `Mastra` 构造 + `./observability` exporter(无需 Studio UI 即可输出 trace)
- 完整 Studio:`npx mastra dev` 拉起本地 Studio UI,连本地 Mastra server over HTTP
- 前置:LLM 调用迁到 `Agent.generate()` 才有 trace 可观测

## 参考

- `docs/decisions/mastra-p3-evaluation.md` v2(P3.5 适配层决议,"不做"条目)
- `src/agents/mastra-adapter.ts`(当前 detached Agent facade)
- `src/agents/registry.ts`(`createAgentRegistryWithMastra`)
- P4.2 `src/audit/export.ts` RBAC 展望框未涉及 Studio(Studio 是 dev 可观测,非企业审计)
