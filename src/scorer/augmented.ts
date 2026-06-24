import type { Contract } from '../contract/schema.js';
import type { CompiledScorer } from '../contract/compiler.js';
import type { Artifact } from '../predicates/types.js';
import type { RubricScore } from '../rubric/types.js';
import type { ScoreReport, AsyncScorer } from './types.js';
import { fanoutJudges } from '../rubric/fanout.js';

const JUDGE_WEIGHT_IN_FINAL = 0.4;

/**
 * createJudgeAugmentedScorer: 包装 Part 1 的确定性 Scorer,加 LLM judge 部分。
 * 实现 AsyncScorer 接口(score 返回 Promise)。
 * final_score = deterministic_score * 0.6 + judge_overall * 0.4
 *
 * 注(eng-review A3):judge fan-out 逻辑委托给共享函数 fanoutJudges,
 * Task 9 的 judgeFanOut Agent 也调用同一函数,避免重复。
 */
export function createJudgeAugmentedScorer(
  baseScorer: CompiledScorer,
  contract: Contract
): AsyncScorer {
  const judgeDims = contract.rubric.filter(r => r.mode === 'judge' || r.mode === 'proxy+judge');

  return {
    async score(artifact: Artifact): Promise<ScoreReport> {
      // 1. 跑确定性部分(Part 1,同步)
      const baseReport = baseScorer.score(artifact);

      // 2. 并行跑 judge rubric(委托给共享 fanoutJudges,eng-review A3)
      const judgeScores: RubricScore[] = await fanoutJudges(artifact, contract);

      // 3. 计算 judge overall_score(加权平均,归一化到 judge 维度的权重和)
      const weightSum = judgeDims.reduce((acc, r) => acc + r.weight, 0);
      // 预建权重 Map(eng-review A2:避免循环内 .find() 重复查找)
      const weightByDim = new Map<string, number>(judgeDims.map(r => [r.dim, r.weight]));
      let judgeOverall = 0;
      for (const s of judgeScores) {
        const w = weightByDim.get(s.dim) ?? 0;
        judgeOverall += s.score * w;
      }
      judgeOverall = weightSum > 0 ? judgeOverall / weightSum : 0.5;

      // 4. 合成最终 ScoreReport
      const deterministicScore = baseReport.deterministic.deterministic_score;
      const finalScore = deterministicScore * (1 - JUDGE_WEIGHT_IN_FINAL) + judgeOverall * JUDGE_WEIGHT_IN_FINAL;

      return {
        deterministic: baseReport.deterministic,
        judge: {
          rubric_scores: judgeScores,
          overall_score: judgeOverall,
        },
        final_score: finalScore,
      };
    },
  };
}
