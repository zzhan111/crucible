import type { Artifact } from '../predicates/types.js';
import type { RubricScore } from './types.js';

export interface JudgeContext {
  artifact: Artifact;
  dim: string;
  weight: number;
  proxy_value?: number; // for proxy+judge mode
}

/** Judge rubric: 异步函数(可能调 LLM),返回 RubricScore */
export type JudgeRubric = (ctx: JudgeContext) => Promise<RubricScore>;

/** 解析 LLM 返回的分数,失败返回 0.5 neutral */
export function parseJudgeScore(raw: string | null, dim: string): number {
  if (raw === null) return 0.5; // 无 API key 降级
  // 尝试提取 0-1 的数字
  const match = raw.match(/(\d+\.?\d*)/);
  if (!match) return 0.5;
  const score = parseFloat(match[1]);
  if (Number.isNaN(score) || score < 0 || score > 1) {
    // 可能是 0-100,归一化
    if (score >= 0 && score <= 100) return score / 100;
    return 0.5;
  }
  return score;
}
