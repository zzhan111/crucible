import type { Contract } from './schema.js';
import type { Artifact, Predicate, Violation } from '../predicates/types.js';
import type { DeterministicRubric } from '../rubric/types.js';
import type { Scorer, ScoreReport } from '../scorer/types.js';
import { continuity } from '../predicates/continuity.js';
import { makeStateMutex } from '../predicates/state_mutex.js';
import { timeBudget } from '../predicates/time_budget.js';
import { noDuplicateState } from '../predicates/no_duplicate_state.js';
import { noEmptySource } from '../predicates/no_empty_source.js';
import { pricingFormat } from '../predicates/pricing_format.js';
import { noDuplicateCompetitor } from '../predicates/no_duplicate_competitor.js';
import { costFit } from '../rubric/cost_fit.js';
import { sourceTrust } from '../rubric/source_trust.js';
import { coverage } from '../rubric/coverage.js';
import { freshness } from '../rubric/freshness.js';

const HARD_VIOLATION_PENALTY = 0.15;

export interface CompiledScorer extends Scorer {
  deterministicPredicateCount: number;
  deterministicRubricCount: number;
}

/**
 * compileContract: Contract → Scorer。
 * P0 实现:把 Contract 里的 4 条硬约束映射到固定 4 个 predicate 函数,
 * 把 2 条 deterministic rubric 映射到固定 2 个 rubric 函数。
 * judge/proxy+judge rubric 在 P0 不编译(留 Part 2)。
 *
 * 技术债(eng-review A3):P0 用 switch(c.id) 硬编码谓词映射,Contract 不是真的
 * "可执行"——是"硬编码约束的声明式包装"。schema 里已有 code_predicate 类型(带 impl
 * 字段),但 compiler 不处理它。Contract-Author Agent(Part 2)若生成新约束 ID,
 * compiler 直接跳过。P1 升级路径:用 isolated-vm 沙箱支持 code_predicate.impl 动态加载,
 * 让契约真可执行(贴合 PRD §6 混合 DSL)。P0 避免沙箱依赖 + 安全审计。
 */
export function compileContract(contract: Contract): CompiledScorer {
  const predicates: Predicate[] = [];
  for (const c of contract.hard_constraints) {
    switch (c.id) {
      case 'continuity': predicates.push(continuity); break;
      case 'state_mutex':
        if (c.type === 'declarative' && c.mutex && c.mutex.length >= 2) {
          predicates.push(makeStateMutex(c.mutex));
        }
        break;
      case 'time_budget': predicates.push(timeBudget); break;
      case 'no_duplicate_state': predicates.push(noDuplicateState); break;
      // P1 §2.8 跨族探针:情报表族谓词
      case 'no_empty_source': predicates.push(noEmptySource); break;
      case 'pricing_format': predicates.push(pricingFormat); break;
      case 'no_duplicate_competitor': predicates.push(noDuplicateCompetitor); break;
      default:
        // 未知约束跳过(P1 支持 code_predicate impl 加载)
        break;
    }
  }

  const rubrics: DeterministicRubric[] = [];
  for (const r of contract.rubric) {
    if (r.mode !== 'deterministic') continue;
    switch (r.dim) {
      case 'cost_fit': rubrics.push(costFit); break;
      case 'source_trust': rubrics.push(sourceTrust); break;
      // P1 §2.8 跨族探针:情报表族 rubric
      case 'coverage': rubrics.push(coverage); break;
      case 'freshness': rubrics.push(freshness); break;
      default: break;
    }
  }

  return {
    deterministicPredicateCount: predicates.length,
    deterministicRubricCount: rubrics.length,
    score(artifact: Artifact): ScoreReport {
      const allViolations: Violation[] = [];
      for (const p of predicates) allViolations.push(...p(artifact));
      const hardViolations = allViolations.filter(v => v.severity === 'hard');
      const rubricScores = rubrics.map(r => r(artifact));
      // P1 修复: deterministic_score = violation_penalty * rubric_avg
      // 之前只算 violation penalty(所有无违规工件 = 1.0,无法区分质量)。
      // 现在乘以 deterministic rubric 平均值(source_trust + cost_fit),
      // 让 source/cost 差异体现在 det_score 中(judge 校准才有区分度)。
      const rubricAvg = rubricScores.length > 0
        ? rubricScores.reduce((acc, r) => acc + r.score, 0) / rubricScores.length
        : 1.0;
      const violationFactor = Math.max(0, 1 - hardViolations.length * HARD_VIOLATION_PENALTY);
      const deterministicScore = Math.max(0, violationFactor * rubricAvg);
      return {
        deterministic: {
          violations: allViolations,
          rubric_scores: rubricScores,
          hard_violation_count: hardViolations.length,
          deterministic_score: deterministicScore,
        },
        judge: null,
        final_score: deterministicScore,
      };
    },
  };
}
