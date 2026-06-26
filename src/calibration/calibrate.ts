import type { Contract } from '../contract/schema.js';
import type { CompiledScorer } from '../contract/compiler.js';
import type { Artifact } from '../predicates/types.js';
import { createJudgeAugmentedScorer } from '../scorer/augmented.js';
import { getGoldenArtifacts, loadHumanRanking } from './golden_set.js';
import { kendallTau, rankingFromScores } from './kendall_tau.js';
import { loadCalibrationReportPath } from './golden_set.js';
import { writeFileSync } from 'node:fs';
import type { CalibrationReport, GoldenArtifact } from './types.js';

const TAU_THRESHOLD = 0.5; // PRD §6: τ > 0.5 可接受

/**
 * runJudgeCalibration: 对黄金集 8 工件跑真实 LLM judge,
 * 计算 judge 排序 vs 人类排序的 Kendall τ(P1 §2.4)。
 *
 * 流程:
 * 1. 用 JudgeAugmentedScorer 对每个黄金工件打分(final_score)
 * 2. 按 final_score 降序生成 judge_ranking
 * 3. 与 human_ranking 算 Kendall τ
 * 4. 每个 judge 维度单独算 τ(per_dim_tau)
 *
 * @returns CalibrationReport
 * @throws 若 human-ranking.jsonl 不存在(未标注)
 */
export async function runJudgeCalibration(
  contract: Contract,
  baseScorer: CompiledScorer
): Promise<CalibrationReport> {
  const human = loadHumanRanking();
  if (!human) {
    throw new Error('runJudgeCalibration: human-ranking.jsonl not found. Run Task 4 annotation first.');
  }

  const golden = getGoldenArtifacts();
  const scorer = createJudgeAugmentedScorer(baseScorer, contract);

  // 1. 跑每个工件的 final_score + per-dim scores
  const finalScores: Record<string, number> = {};
  const perDimScores: Record<string, Record<string, number>> = {}; // dim → {id: score}

  for (const g of golden) {
    const report = await scorer.score(g.artifact as Artifact);
    finalScores[g.id] = report.final_score;
    // 收集每个 judge 维度的分数(judge 在 JudgeAugmentedScorer 下必填,但类型可 null)
    if (report.judge) {
      for (const rs of report.judge.rubric_scores) {
        if (!perDimScores[rs.dim]) perDimScores[rs.dim] = {};
        perDimScores[rs.dim][g.id] = rs.score;
      }
    }
  }

  // 2. judge 排序(按 final_score 降序)
  const judgeRanking = rankingFromScores(finalScores);

  // 3. 整体 τ
  const overallResult = kendallTau(judgeRanking, human.ranking);

  // 4. per-dim τ(若该维度有分数)
  const perDimTau: Record<string, number> = {};
  for (const [dim, scores] of Object.entries(perDimScores)) {
    const dimRanking = rankingFromScores(scores);
    try {
      const dimResult = kendallTau(dimRanking, human.ranking);
      perDimTau[dim] = dimResult.tau;
    } catch {
      // 维度排名与人类排名元素不匹配(不该发生),跳过
      perDimTau[dim] = 0;
    }
  }

  const report: CalibrationReport = {
    created_at: new Date().toISOString(),
    overall_tau: overallResult.tau,
    per_dim_tau: perDimTau,
    verdict: overallResult.tau > TAU_THRESHOLD ? 'pass' : 'fail',
    threshold: TAU_THRESHOLD,
    judge_ranking: judgeRanking,
    human_ranking: human.ranking,
  };

  return report;
}

/**
 * saveCalibrationReport: 持久化校准报告到 golden/calibration-report.json。
 */
export function saveCalibrationReport(report: CalibrationReport): string {
  const path = loadCalibrationReportPath();
  writeFileSync(path, JSON.stringify(report, null, 2), 'utf8');
  return path;
}
