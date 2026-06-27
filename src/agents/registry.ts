// Registry(P0 降级实现;P3.5 §2.1.1 接回 Mastra v1.x)。
// 历史:Mastra 0.1.x peer dep 缺失 → SimpleAgent 降级。
// P3.5:@mastra/core v1.47.0 peer dep 仅 zod,prisma 问题消失,`Agent` 从
// `@mastra/core/agent` 导出。createAgentRegistry() 行为不变(默认 SimpleAgent);
// createAgentRegistryWithMastra() 返回 Mastra-backed facade(CRUCIBLE_USE_MASTRA=1)。
import { createContractAuthorAgent } from './contract-author.js';
import { createScorerAgent } from './scorer.js';
import { createJudgeAgent } from './judge.js';
import { generatePatches } from './critic.js';
import { detectNovelty } from './curator.js';
import { createMastraAgent, type MastraBackedAgent } from './mastra-adapter.js';

export interface AgentRegistry {
  contractAuthor: ReturnType<typeof createContractAuthorAgent>;
  scorer: ReturnType<typeof createScorerAgent>;
  judge: ReturnType<typeof createJudgeAgent>;
}

export function createAgentRegistry(): AgentRegistry {
  return {
    contractAuthor: createContractAuthorAgent(),
    scorer: createScorerAgent(),
    judge: createJudgeAgent(),
  };
}

/**
 * P3.5 §2.1.1:返回 Mastra-backed agent registry。
 * 每个 agent 结构兼容 SimpleAgent(保留 name + instructions),
 * 额外暴露 getMastraAgent(model) 以备 orchestration/memory/streaming。
 * 默认(CRUCIBLE_USE_MASTRA 未设)时 getMastraAgent 不挂载,等同 SimpleAgent。
 */
export interface MastraAgentRegistry {
  contractAuthor: MastraBackedAgent;
  scorer: MastraBackedAgent;
  judge: MastraBackedAgent;
}

export function createAgentRegistryWithMastra(): MastraAgentRegistry {
  return {
    contractAuthor: createMastraAgent(
      'contract-author',
      `You are the Contract-Author agent. In P1, you read the current Contract YAML + Curator novelty proposals, then generate a revision diff (ContractPatch). You do not auto-apply; output goes to Human Gate for approval.`
    ),
    scorer: createMastraAgent(
      'scorer',
      `You are the Scorer agent. You run the JudgeAugmentedScorer: first deterministic checks (Part 1), then fan out to Judge sub-agents for LLM rubrics. You return a complete ScoreReport.`
    ),
    judge: createMastraAgent(
      'judge',
      `You are the Judge agent. You fan out to 3 judge rubrics (routing, memorability, dining_fit) in parallel and collect their RubricScores.`
    ),
  };
}

export { generatePatches, detectNovelty };
