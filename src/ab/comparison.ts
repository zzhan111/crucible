import type { Contract } from '../contract/schema.js';
import type { CompiledScorer } from '../contract/compiler.js';
import type { Artifact } from '../predicates/types.js';
import { createJudgeAugmentedScorer } from '../scorer/augmented.js';
import { getGoldenArtifacts } from '../calibration/golden_set.js';
import { loadHumanRanking } from '../calibration/golden_set.js';
import { kendallTau, rankingFromScores } from '../calibration/kendall_tau.js';

export type ABVerdict = 'promote' | 'retain';

export interface ABResult {
  /** champion(当前版)Contract τ */
  champion_tau: number;
  /** challenger(修订版)Contract τ */
  challenger_tau: number;
  /** τ 差值(challenger - champion) */
  tau_delta: number;
  /** 判定:promote(挑战者更优)/ retain(保持冠军) */
  verdict: ABVerdict;
  /** champion 排序 */
  champion_ranking: string[];
  /** challenger 排序 */
  challenger_ranking: string[];
  /** 人类排序(参考基线) */
  human_ranking: string[];
}

/**
 * runABComparison (P1 §2.7): 对同一组黄金工件,
 * 同时跑 champion 和 challenger 两套 Contract,比较 Kendall τ。
 *
 * - challenger τ 更高 → promote(升级为新 champion)
 * - challenger τ 更低或持平 → retain(保持 champion)
 *
 * 实现复用 runJudgeCalibration 的逻辑,但接受两个 Contract。
 *
 * @param champion 当前版 Contract
 * @param challenger 修订版 Contract
 * @param championScorer champion 的编译 scorer
 * @param challengerScorer challenger 的编译 scorer
 * @returns ABResult
 */
export async function runABComparison(
  champion: Contract,
  challenger: Contract,
  championScorer: CompiledScorer,
  challengerScorer: CompiledScorer
): Promise<ABResult> {
  const human = loadHumanRanking();
  if (!human) {
    throw new Error('runABComparison: human-ranking.jsonl not found. Run Task 4 annotation first.');
  }

  const golden = getGoldenArtifacts();

  // 跑 champion
  const championScorerAug = createJudgeAugmentedScorer(championScorer, champion);
  const championScores: Record<string, number> = {};
  for (const g of golden) {
    const report = await championScorerAug.score(g.artifact as Artifact);
    championScores[g.id] = report.final_score;
  }
  const championRanking = rankingFromScores(championScores);
  const championResult = kendallTau(championRanking, human.ranking);

  // 跑 challenger
  const challengerScorerAug = createJudgeAugmentedScorer(challengerScorer, challenger);
  const challengerScores: Record<string, number> = {};
  for (const g of golden) {
    const report = await challengerScorerAug.score(g.artifact as Artifact);
    challengerScores[g.id] = report.final_score;
  }
  const challengerRanking = rankingFromScores(challengerScores);
  const challengerResult = kendallTau(challengerRanking, human.ranking);

  const tauDelta = challengerResult.tau - championResult.tau;
  // promote 需严格更优(避免噪声),阈值 0.01
  const verdict: ABVerdict = tauDelta > 0.01 ? 'promote' : 'retain';

  return {
    champion_tau: championResult.tau,
    challenger_tau: challengerResult.tau,
    tau_delta: tauDelta,
    verdict,
    champion_ranking: championRanking,
    challenger_ranking: challengerRanking,
    human_ranking: human.ranking,
  };
}
