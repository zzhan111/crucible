import type { JudgeRubric, JudgeContext } from './judge-types.js';
import { parseJudgeScore } from './judge-types.js';
import { callLLM } from '../llm/client.js';

export const memorabilityJudge: JudgeRubric = async (ctx: JudgeContext) => {
  const prompt = `You are evaluating a travel itinerary's memorability — how many unique, distinctive, well-sourced experiences it contains.

Itinerary nodes:
${JSON.stringify(ctx.artifact.nodes.map(n => ({ action: n.action, node_type: n.node_type, duration_min: n.duration_min, source: n.source, source_trust: n.source_trust })), null, 2)}

Rate memorability 0.0 to 1.0. Scoring criteria (weight by importance):
1. ICONIC EXPERIENCES (most important): Famous hikes (Dragon's Back 龙脊, Cangshan 苍山), unique activities (beach foraging 赶海, reef exploration) = high score. Generic sightseeing or temple visits = medium.
2. ACTIVITY DENSITY: More distinct activities across multiple locations beats sitting at ONE spot for hours. An itinerary with 4-5 varied nodes beats one with a single 6-hour stop.
3. PENALTY for single-location stagnation: If one node exceeds 4 hours (240 min) and it's not a hike, that's poor planning, NOT depth — lower the score.
4. SOURCE DIVERSITY: Multiple distinct sources (source_trust > 0.7, different source names) = more reliable = higher. Single low-trust source (source_trust < 0.5, same source repeated) = lower.
5. COMPLETENESS: Complete itineraries (dining + transit + core experience) beat sparse ones (only transit + 1 stop).

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
