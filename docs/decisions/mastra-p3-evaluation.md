# Decision: Mastra 架构定调 — v2 (P3.5 §2.1.1)

> Supersedes v1 (P3 评估)。v1 结论:Mastra 0.1.x peer dep 缺失,保留 SimpleAgent,P4 重评。
> v2 结论:**接回 Mastra,走适配层路径。** `@mastra/core` v1.47.0 peer dep 仅 zod,prisma 问题消失。

## 状态:ADOPTED (适配层路径)

## v1 → v2 变更原因

P3 评估时 `@mastra/core` 处于 0.1.x,`@prisma-app/client` peer dep 缺失导致模块加载失败。
P3.5 重评时 npm 上 `@mastra/core` 已到 **1.47.0**,关键变化:

| 项 | v1 (0.1.x) | v2 (1.47.0) |
|----|-----------|-------------|
| peerDependencies | 含 `@prisma-app/client`(缺失) | 仅 `zod ^3.25\|\|^4.0` |
| `Agent` 导出 | 顶层缺失 | `@mastra/core/agent` 子路径导出 |
| 构造所需 | — | `{name, instructions, model}` |
| prisma 在 deps | 是 | 否 |

`@mastra/agents` 包**不存在**(npm 404)。Agent 类在 `@mastra/core/agent` 子路径。

## 调研证据

```
$ npm view @mastra/core@1.47.0 peerDependencies
{ "zod": "^3.25.0 || ^4.0.0" }

$ node -e "import('@mastra/core/agent').then(m=>console.log(typeof m.Agent))"
function   # _Agent 类
```

mock model 构造验证通过:`new Agent({name,instructions,model})` 成功,实例有 `generate`/`stream` 方法。

## 决议:适配层路径(非全量替换)

**不**把所有 agent 全量替换为 Mastra Agent。理由:
- Crucible 的 agent (contract-author/judge/scorer) 当前是**纯注册容器**(`{name, instructions}`),
  LLM 调用走 `ai` SDK (`fanoutJudges` / `callLLM`),不经 Agent 实例。
- 全量替换会改 LLM 调用路径,破坏 P0-P3 全部测试,且 Mastra Agent 需要 `model` 才能构造,
  与"注册期无 model"的现状冲突。

**采用适配层**:
- 新增 `src/agents/mastra-adapter.ts`:`createMastraAgent(name, instructions)` 返回
  `MastraBackedAgent`(结构兼容 `SimpleAgent`,额外暴露 `getMastraAgent(model)`)。
- 默认 (`CRUCIBLE_USE_MASTRA` 未设): facade 不挂 `getMastraAgent`,等同 SimpleAgent —
  P3 行为零变化,测试确定。
- `CRUCIBLE_USE_MASTRA=1`: facade 挂 `getMastraAgent(model)`,调用方可获得真实 Mastra Agent
  以备 orchestration/memory/streaming。
- 新增 `createAgentRegistryWithMastra()` 提供三 agent 的 Mastra-backed 版本。
- `base.ts` 注释更新为"P3.5 接回 Mastra",`SimpleAgent` 接口不变。

## 落地物

- `src/agents/mastra-adapter.ts`(适配层 + memoize)
- `src/agents/registry.ts` 新增 `createAgentRegistryWithMastra()`
- `src/agents/base.ts` 注释更新(历史 + 现状)
- `tests/agents/mastra-adapter.test.ts`(5 tests:flag 默认/开启、结构兼容、实例构造、memoize)
- `@mastra/core@^1.47.0` 加入生产 deps

## 不做

- 不全量替换 agent LLM 调用路径(留 P4,需 Mastra Studio 可观测端点配合)。
- 不引入 Mastra Server / Studio 运行时(适配层就位即可,P4 视 ToB 需求决定)。

## 关闭的 Open Questions

- OQ-Mastra(P0 起):Mastra 是否采用 → **采用,适配层形态**,关闭。
