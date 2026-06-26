import type { Artifact } from '../predicates/types.js';
import type { RubricScore, DeterministicRubric } from './types.js';

/**
 * freshness (P1 §2.8 跨族探针):情报新鲜度。
 * 度量:last_verified 距今天数越短分越高。
 * - 30 天内:1.0
 * - 90 天内:0.8
 * - 180 天内:0.5
 * - 365 天内:0.3
 * - >365 天或无法解析:0.1
 * 适用于 table 族。
 *
 * 注:测试环境用固定参考日期(2026-06-25)避免时间依赖。
 */
const REFERENCE_DATE = new Date('2026-06-25');

export const freshness: DeterministicRubric = (artifact: Artifact): RubricScore => {
  const nodes = artifact.nodes;
  if (nodes.length === 0) return { dim: 'freshness', score: 0, mode: 'deterministic', rationale: 'empty table' };

  let totalScore = 0;
  let parsedCount = 0;
  for (const n of nodes) {
    const lv = n.last_verified;
    if (lv === undefined || lv === null || String(lv).trim() === '') {
      totalScore += 0.1;
      continue;
    }
    const date = new Date(String(lv));
    if (isNaN(date.getTime())) {
      totalScore += 0.1;
      continue;
    }
    parsedCount++;
    const daysAgo = Math.floor((REFERENCE_DATE.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
    if (daysAgo <= 30) totalScore += 1.0;
    else if (daysAgo <= 90) totalScore += 0.8;
    else if (daysAgo <= 180) totalScore += 0.5;
    else if (daysAgo <= 365) totalScore += 0.3;
    else totalScore += 0.1;
  }
  const score = totalScore / nodes.length;
  return {
    dim: 'freshness',
    score,
    mode: 'deterministic',
    rationale: `${parsedCount}/${nodes.length} dates parsed, avg freshness=${score.toFixed(2)}`,
  };
};
