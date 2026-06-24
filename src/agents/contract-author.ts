import { createSimpleAgent, type SimpleAgent } from './base.js';
import type { Contract } from '../contract/schema.js';

// P0:Contract-Author 只读现有契约,不自动改(P1 加 LLM 修订能力)
// 降级实现(spec §7):用 SimpleAgent 替代 Mastra Agent,P2 升级时替换
export function createContractAuthorAgent(): SimpleAgent {
  return createSimpleAgent(
    'contract-author',
    `You are the Contract-Author agent. In P0, you read and return the current Contract YAML without modification. You ensure the contract is well-formed before passing to the Scorer.`
  );
}

export function contractAuthorRead(contract: Contract): Contract {
  console.log('[Contract-Author] reading contract (P0: no modification)');
  return contract;
}
