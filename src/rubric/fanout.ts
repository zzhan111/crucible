import type { Contract } from '../contract/schema.js';
import type { Artifact } from '../predicates/types.js';
import type { RubricScore } from './types.js';
import type { JudgeContext } from './judge-types.js';
import { routingJudge, routingProxy } from './routing.judge.js';
import { memorabilityJudge } from './memorability.judge.js';
import { diningFitJudge } from './dining_fit.judge.js';
import { strategicInsightJudge } from './strategic_insight.judge.js'; // P4.6 intel 深化

/**
 * fanoutJudges: 共享的 judge fan-out 逻辑(eng-review A3 DRY 修复)。
 * Task 4 JudgeAugmentedScorer 和 Task 9 judgeFanOut Agent 都调用此函数,
 * 避免两处重复实现 judge 派发逻辑。
 *
 * 输入:artifact + contract(含 judge/proxy+judge rubric 定义)
 * 输出:并行跑所有 judge rubric 的 RubricScore[]
 */
export async function fanoutJudges(
  artifact: Artifact,
  contract: Contract
): Promise<RubricScore[]> {
  const judgeDims = contract.rubric.filter(r => r.mode === 'judge' || r.mode === 'proxy+judge');
  const promises: Promise<RubricScore>[] = [];
  for (const r of judgeDims) {
    const ctx: JudgeContext = {
      artifact,
      dim: r.dim,
      weight: r.weight,
      proxy_value: r.mode === 'proxy+judge' ? routingProxy(artifact) : undefined,
    };
    if (r.dim === 'routing') promises.push(routingJudge(ctx));
    else if (r.dim === 'memorability') promises.push(memorabilityJudge(ctx));
    else if (r.dim === 'dining_fit') promises.push(diningFitJudge(ctx));
    else if (r.dim === 'strategic_insight') promises.push(strategicInsightJudge(ctx)); // P4.6 intel 深化
  }
  return Promise.all(promises);
}
