import type { Violation } from '../predicates/types.js';
import type { RubricScore } from '../rubric/types.js';
import type { Artifact } from '../predicates/types.js';

export interface DeterministicReport {
  violations: Violation[];
  rubric_scores: RubricScore[];
  hard_violation_count: number;
  /** 确定性部分总分 = 1 - (hard_violation_count * penalty) ,clamp 到 [0,1]。
   *  P0 penalty = 0.15 per violation。*/
  deterministic_score: number;
}

export interface ScoreReport {
  deterministic: DeterministicReport;
  judge: {
    rubric_scores: RubricScore[];
    overall_score: number;
  } | null; // Part 1 永远 null,Part 2 才填
  /** 最终总分 = deterministic_score * 0.6 + judge.overall_score * 0.4 (Part 2 才有意义)
   *  Part 1 阶段 final_score = deterministic_score */
  final_score: number;
}

export interface Scorer {
  score(artifact: Artifact): ScoreReport;
}
