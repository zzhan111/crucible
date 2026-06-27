import type { Contract } from '../contract/schema.js';
import type { CompiledScorer } from '../contract/compiler.js';
import type { Artifact } from '../predicates/types.js';
import type { RubricScore } from '../rubric/types.js';
import type { ScoreReport, AsyncScorer } from './types.js';
import { fanoutJudges } from '../rubric/fanout.js';
import { getScorerCache, scorerCacheKey } from '../cache/scorer-cache.js';

const JUDGE_WEIGHT_IN_FINAL = 0.4;

/**
 * createJudgeAugmentedScorer: 包装 Part 1 的确定性 Scorer,加 LLM judge 部分。
 * 实现 AsyncScorer 接口(score 返回 Promise)。
 * final_score = deterministic_score * 0.6 + judge_overall * 0.4
 *
 * P3 §2.2: 集成 Scorer 缓存。同工件+同契约版本第二次打分命中缓存(不重算)。
 * 缓存 key = hash(artifact + contract_version),TTL 10 分钟。
 *
 * 注(eng-review A3):judge fan-out 逻辑委托给共享函数 fanoutJudges。
 */
export function createJudgeAugmentedScorer(
  baseScorer: CompiledScorer,
  contract: Contract
): AsyncScorer {
  const judgeDims = contract.rubric.filter(r => r.mode === 'judge' || r.mode === 'proxy+judge');
  const contractVersion = (contract as Contract & { metadata?: { version?: number } }).metadata?.version ?? 'v1';

  return {
    async score(artifact: Artifact): Promise<ScoreReport> {
      // P3 §2.2: 查缓存
      const cache = getScorerCache();
      const key = scorerCacheKey(artifact, contractVersion);
      const cached = cache.get(key);
      if (cached) {
        return cached;
      }

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

      const report: ScoreReport = {
        deterministic: baseReport.deterministic,
        judge: {
          rubric_scores: judgeScores,
          overall_score: judgeOverall,
        },
        final_score: finalScore,
      };

      // P3 §2.2: 存缓存
      cache.set(key, report);

      return report;
    },
  };
}
