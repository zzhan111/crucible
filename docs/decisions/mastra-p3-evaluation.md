# Mastra P3 评估报告

> Date: 2026-06-27
> 评估人: AI agent (P3 §2.1)
> 决议: **保持 SimpleAgent,不升级 Mastra**

---

## 1. 评估背景

P0 降级原因: `@mastra/core@0.1.26` 有缺失 peer dep `@prisma-app/client`,导致安装失败。
P2 spec §5 将 "Mastra 升级评估" 延期到 P3 执行。

## 2. 调研结果

### 2.1 版本对比

| 指标 | P0 时期(0.1.26) | 当前(1.47.0) |
|------|----------------|-------------|
| 版本 | 0.1.26 | 1.47.0 |
| peer deps | @prisma-app/client(缺失) | zod ^3.25.0 \|\| ^4.0.0 |
| peer dep 修复 | ❌ | ✅ (prisma 问题已解决) |
| Agent 导出 | `Agent` 在 core | `Agent` **不在 core** |
| core 导出 | Agent + Mastra | 仅 `Mastra` |

### 2.2 安装验证

- `npm install @mastra/core` 成功(无 peer dep 错误)
- `import { Mastra } from '@mastra/core'` 成功
- `import { Agent } from '@mastra/core'` **失败** — v1.x 把 Agent 移走

### 2.3 API 破坏性变更

Mastra v1.x 是重大架构变更:
- `Agent` 不再从 `@mastra/core` 导出(可能需 `@mastra/agent` 包,但 npm 404)
- `Mastra` 类 API 与 P0 设计的 `new Agent({name, instructions})` 完全不同
- 升级需要重写整个 `src/agents/` 层(base/registry/scorer/judge/critic/curator/contract-author)

## 3. 决议: 保持 SimpleAgent

### 3.1 理由

1. **API 破坏性变更**: Mastra v1.x 的 Agent API 与 P0-P3 设计不兼容,升级需重写 agent 层(7 个文件),工程量大且高风险
2. **SimpleAgent 运行良好**: 253 tests pass, τ=0.64, 跨族 GO, MCP/UI/沙箱全部工作 — SimpleAgent 满足所有功能需求
3. **Studio 可观测性非必需**: P0-P3 的 console.log 标签 + HTML 报告已提供足够可观测性
4. **ROI 低**: 升级成本(重写+回归测试) > 收益(Studio UI)

### 3.2 SimpleAgent 替代方案(已实现)

```typescript
// src/agents/base.ts
export interface SimpleAgent { name: string; instructions: string; }
export function createSimpleAgent(name, instructions): SimpleAgent { ... }
```

所有 agent(scorer/judge/critic/curator/contract-author)用 SimpleAgent + 纯函数实现,
不依赖 Mastra Agent 类。功能完整,测试覆盖。

### 3.3 未来升级路径(P4+)

若需 Mastra Studio 可观测性:
1. 调研 Mastra v1.x 的 `Agent` 正确导入路径(可能需 `@mastra/agents` 或 v2.x)
2. 写适配层: SimpleAgent → Mastra Agent wrapper(不改业务逻辑)
3. 逐个 agent 迁移 + 回归测试
4. 启用 Studio(需 Mastra Server)

## 4. 结论

**P3 不升级 Mastra。** 保持 SimpleAgent,记录决议。Mastra v1.x peer dep 已修复,但 API 破坏性变更使升级成本过高。SimpleAgent 满足所有功能需求,P4+ 再评估升级。

**STATUS: 决议已记录,保持现状。**
