import { createSimpleAgent, type SimpleAgent } from './base.js';
import type { Artifact } from '../predicates/types.js';
import type { Contract } from '../contract/schema.js';
import type { RubricScore } from '../rubric/types.js';
import { fanoutJudges } from '../rubric/fanout.js';

export function createJudgeAgent(): SimpleAgent {
  return createSimpleAgent(
    'judge',
    `You are the Judge agent. You fan out to 3 judge rubrics (routing, memorability, dining_fit) in parallel and collect their RubricScores.`
  );
}

/**
 * judgeFanOut: Agent 包装的 judge fan-out。
 * 委托给共享函数 fanoutJudges(eng-review A3 DRY 修复),
 * 与 Task 4 JudgeAugmentedScorer 共用同一 fan-out 逻辑。
 */
export async function judgeFanOut(
  artifact: Artifact,
  contract: Contract
): Promise<RubricScore[]> {
  console.log('[Judge] fanning out to judge rubrics in parallel (via shared fanoutJudges)');
  const results = await fanoutJudges(artifact, contract);
  console.log(`[Judge] collected ${results.length} judge scores`);
  return results;
}
