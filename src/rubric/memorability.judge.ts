import type { JudgeRubric, JudgeContext } from './judge-types.js';
import { parseJudgeScore } from './judge-types.js';
import { callLLM } from '../llm/client.js';

export const memorabilityJudge: JudgeRubric = async (ctx: JudgeContext) => {
  const prompt = `You are evaluating a travel itinerary's memorability — how many unique, distinctive experiences it contains.
Nodes: ${JSON.stringify(ctx.artifact.nodes.map(n => ({ action: n.action, node_type: n.node_type })))}
Rate memorability 0.0 to 1.0. Core experiences (hikes, iconic spots) boost score; generic dining/transit don't.
Respond with only a number between 0 and 1.`;
  const raw = await callLLM(prompt);
  const score = parseJudgeScore(raw, 'memorability');
  return {
    dim: 'memorability',
    score,
    mode: 'judge',
    rationale: `judge=${raw ?? 'null(neutral)'}`,
  };
};
