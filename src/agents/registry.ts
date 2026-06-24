// Registry(P0 降级实现,不依赖 Mastra)。
// spec §7 降级:Mastra 0.1.x 有缺失 peer dep,用 SimpleAgent 替代。
// P2 升级 Mastra 时,把 createSimpleAgent 替换为 new Agent({...})。
import { createContractAuthorAgent } from './contract-author.js';
import { createScorerAgent } from './scorer.js';
import { createJudgeAgent } from './judge.js';
import { generatePatches } from './critic.js';
import { detectNovelty } from './curator.js';

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

export { generatePatches, detectNovelty };
