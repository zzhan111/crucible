import type { Artifact } from '../predicates/types.js';

export interface RubricScore {
  dim: string;
  score: number;        // 0.0 - 1.0
  mode: 'deterministic' | 'judge' | 'proxy+judge';
  rationale: string;
  proxy_value?: number; // for proxy+judge mode
}

/** Deterministic rubric: 纯函数,artifact → RubricScore */
export type DeterministicRubric = (artifact: Artifact) => RubricScore;

/**
 * Rubric 缺失数据默认值约定(eng-review C3):
 * - "无基准=中性 0.5":评估基准缺失(如 cost_fit 无 budget metadata)→ 返回 0.5。
 *   语义:不知道好坏,不奖不罚。适用于"评估对象(基准)缺失"。
 * - "无证据=0.0":被评估物本身缺失(如 source_trust 无 source_trust 字段)→ 返回 0.0。
 *   语义:无来源=不可信,直接罚。适用于"被评估物(证据)缺失"。
 * 新增 deterministic rubric 时,按此约定判断缺失数据走哪种默认。
 */
