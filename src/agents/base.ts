/**
 * Agent 基类(P0 降级实现,不依赖 Mastra)。
 *
 * spec §7 降级:Mastra 0.1.x 有缺失 peer dep(@prisma-app/client)导致模块加载失败。
 * P0 不需要 Mastra 运行时能力(orchestration/memory/streaming),只需要:
 * 1. Agent 有 name + instructions(文档化 + 未来迁移到 Mastra 时可直接替换)
 * 2. 可观测(通过 console.log tag)
 *
 * P2 升级 Mastra 时,把 SimpleAgent 替换为 Mastra Agent,接口保持兼容。
 */
export interface SimpleAgent {
  name: string;
  instructions: string;
}

export function createSimpleAgent(name: string, instructions: string): SimpleAgent {
  return { name, instructions };
}
