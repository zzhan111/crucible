/**
 * Agent 基类(P0 降级实现,不依赖 Mastra;P3.5 §2.1.1 接回 Mastra v1.x)。
 *
 * 历史:P0 时 Mastra 0.1.x 有缺失 peer dep(@prisma-app/client)导致模块加载失败,
 * 降级为 SimpleAgent(纯 {name, instructions} 数据结构)。
 * P3.5 调研结论:@mastra/core v1.47.0 peer dep 仅 zod,prisma 问题消失,
 * `Agent` 从 `@mastra/core/agent` 子路径导出。
 *
 * 当前形态:SimpleAgent 仍是所有 agent factory 的对外契约(各 consumer 只读
 * name + instructions,LLM 调用走 ai SDK 不经 Agent)。P3.5 通过 createAgent()
 * 统一入口:默认走 SimpleAgent;CRUCIBLE_USE_MASTRA=1 时返回 Mastra-backed
 * facade(结构兼容 SimpleAgent,额外暴露 getMastraAgent(model) 以备 orchestration)。
 * 详见 mastra-adapter.ts。
 */
export interface SimpleAgent {
  name: string;
  instructions: string;
}

export function createSimpleAgent(name: string, instructions: string): SimpleAgent {
  return { name, instructions };
}
