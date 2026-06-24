import type { Artifact } from '../predicates/types.js';
import type { JudgeRubric, JudgeContext } from './judge-types.js';
import { parseJudgeScore } from './judge-types.js';
import { callLLM } from '../llm/client.js';

/** 计算 proxy_value:transit/switch 桥接覆盖率(0-1) */
export function routingProxy(artifact: Artifact): number {
  const nodes = artifact.nodes;
  if (nodes.length < 2) return 1.0;
  let bridgedPairs = 0;
  let totalPairs = 0;
  for (let i = 0; i < nodes.length - 1; i++) {
    totalPairs++;
    const a = String(nodes[i].node_type ?? '');
    const b = String(nodes[i + 1].node_type ?? '');
    if (a === 'transit' || a === 'switch' || b === 'transit' || b === 'switch') {
      bridgedPairs++;
    }
  }
  return totalPairs === 0 ? 1.0 : bridgedPairs / totalPairs;
}

export const routingJudge: JudgeRubric = async (ctx: JudgeContext) => {
  const proxy = ctx.proxy_value ?? routingProxy(ctx.artifact);
  const prompt = `You are evaluating a travel itinerary's routing smoothness.
Proxy metric (bridge coverage): ${proxy.toFixed(2)}
Nodes: ${JSON.stringify(ctx.artifact.nodes.map(n => ({ action: n.action, node_type: n.node_type, route: n.route })))}
Rate the routing smoothness on a scale of 0.0 to 1.0. Consider: are transitions natural? Any backtracking? Realistic travel times?
Respond with only a number between 0 and 1.`;
  const raw = await callLLM(prompt);
  const score = parseJudgeScore(raw, 'routing');
  return {
    dim: 'routing',
    score,
    mode: 'proxy+judge',
    rationale: `proxy=${proxy.toFixed(2)}, judge=${raw ?? 'null(neutral)'}`,
    proxy_value: proxy,
  };
};
