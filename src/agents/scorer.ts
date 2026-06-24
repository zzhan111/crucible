import { createSimpleAgent, type SimpleAgent } from './base.js';
import type { Contract } from '../contract/schema.js';
import type { CompiledScorer } from '../contract/compiler.js';
import type { Artifact } from '../predicates/types.js';
import type { ScoreReport } from '../scorer/types.js';
import { createJudgeAugmentedScorer } from '../scorer/augmented.js';

export function createScorerAgent(): SimpleAgent {
  return createSimpleAgent(
    'scorer',
    `You are the Scorer agent. You run the JudgeAugmentedScorer: first deterministic checks (Part 1), then fan out to Judge sub-agents for LLM rubrics. You return a complete ScoreReport.`
  );
}

export async function scorerRun(
  artifact: Artifact,
  baseScorer: CompiledScorer,
  contract: Contract
): Promise<ScoreReport> {
  console.log('[Scorer] scoring artifact (deterministic + judge fan-out)');
  const augmented = createJudgeAugmentedScorer(baseScorer, contract);
  return augmented.score(artifact);
}
