import type { JudgeRubric, JudgeContext } from './judge-types.js';
import { parseJudgeScore } from './judge-types.js';
import { callLLM } from '../llm/client.js';

export const diningFitJudge: JudgeRubric = async (ctx: JudgeContext) => {
  const prompt = `You are evaluating how well the dining arrangements fit a traveler's preferences.
Dining nodes: ${JSON.stringify(ctx.artifact.nodes.filter(n => n.node_type === 'dining').map(n => ({ action: n.action, cost: n.cost })))}
Rate dining fit 0.0 to 1.0. Consider variety, local character, reasonable cost.
Respond with only a number between 0 and 1.`;
  const raw = await callLLM(prompt);
  const score = parseJudgeScore(raw, 'dining_fit');
  return {
    dim: 'dining_fit',
    score,
    mode: 'judge',
    rationale: `judge=${raw ?? 'null(neutral)'}`,
  };
};
