import { describe, it, expect } from 'vitest';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadContract } from '../../src/contract/validate.js';
import { compileContract } from '../../src/contract/compiler.js';
import { detectNovelty } from '../../src/agents/curator.js';
import { intelTableBuggy, intelTableGolden } from '../../src/fixtures/intel-table.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const INTEL_CONTRACT_PATH = join(__dirname, '..', '..', 'contracts', 'intel-table-v1.yaml');

/**
 * P1 §2.8 跨族探针:验证同一套 DSL(字段+约束+rubric 结构)能否跨族使用。
 *
 * go/no-go 判定标准(OQ-13):
 * - go: 情报表族 Contract 能加载 + 编译 + Scorer 跑通 + bug 被抓出
 * - no-go: 需要方言(不同 schema 结构)→ 记录决议留 P2
 */
describe('P1 §2.8 跨族探针 — 情报表族', () => {
  const contract = loadContract(INTEL_CONTRACT_PATH);
  const scorer = compileContract(contract);

  it('intel-table-v1.yaml 加载成功(同 DSL schema;v1.1 深化后约束/rubric 扩容)', () => {
    expect(contract.artifact_family).toBe('table');
    expect(contract.fields.length).toBeGreaterThan(0);
    // v1: 3 hard_constraints;v1.1 (P4.6): +3(stale_pricing/source_trust_floor/unit_consistency)= 6
    expect(contract.hard_constraints.length).toBe(6);
    // v1: 3 rubric(全 deterministic);v1.1: 5(4 deterministic + 1 judge strategic_insight)
    expect(contract.rubric.length).toBe(5);
  });

  it('编译成功:6 个谓词 + 4 个 deterministic rubric(v1.1;+1 judge strategic_insight 不计入 deterministic)', () => {
    expect(scorer.deterministicPredicateCount).toBe(6);
    expect(scorer.deterministicRubricCount).toBe(4);
  });

  it('buggy 情报表:3 个硬违规被抓出(缺 source / pricing 未知 / 重复竞品;v1.1 source_trust_floor 对 0.3 触发 soft)', () => {
    const report = scorer.score(intelTableBuggy);
    expect(report.deterministic.hard_violation_count).toBe(3);
    const hardIds = report.deterministic.violations
      .filter(v => v.severity === 'hard')
      .map(v => v.constraint_id).sort();
    expect(hardIds).toEqual(['no_duplicate_competitor', 'no_empty_source', 'pricing_format']);
    // v1.1 source_trust_floor 对 source_trust=0.3 触发 soft(不阻断,需复核)
    const soft = report.deterministic.violations.filter(v => v.severity === 'soft');
    expect(soft.some(v => v.constraint_id === 'source_trust_floor')).toBe(true);
  });

  it('buggy 情报表:每个违规有 fix_hint', () => {
    const report = scorer.score(intelTableBuggy);
    for (const v of report.deterministic.violations) {
      expect(v.fix_hint).toBeTruthy();
      expect(v.fix_hint!.length).toBeGreaterThan(5);
    }
  });

  it('golden 情报表:零硬违规', () => {
    const report = scorer.score(intelTableGolden);
    expect(report.deterministic.hard_violation_count).toBe(0);
  });

  it('golden 分数高于 buggy(违规惩罚生效)', () => {
    const goldenReport = scorer.score(intelTableGolden);
    const buggyReport = scorer.score(intelTableBuggy);
    expect(goldenReport.deterministic.deterministic_score)
      .toBeGreaterThan(buggyReport.deterministic.deterministic_score);
  });

  it('deterministic rubric 包含 coverage + freshness + source_trust + differentiator_density(v1.1)', () => {
    const report = scorer.score(intelTableGolden);
    const dims = report.deterministic.rubric_scores.map(r => r.dim);
    expect(dims).toContain('coverage');
    expect(dims).toContain('freshness');
    expect(dims).toContain('source_trust');
    expect(dims).toContain('differentiator_density');
    // strategic_insight 是 judge,不进 deterministic.rubric_scores
    expect(dims).not.toContain('strategic_insight');
  });

  it('coverage rubric:golden 表全覆盖(1.0)', () => {
    const report = scorer.score(intelTableGolden);
    const cov = report.deterministic.rubric_scores.find(r => r.dim === 'coverage');
    expect(cov).toBeDefined();
    expect(cov!.score).toBe(1.0);
  });

  it('Curator detectNovelty 在情报表上正常运行(跨族兼容)', async () => {
    // 情报表的 state 字段为空,knownStates 也为空 → 无新颖度
    const proposals = await detectNovelty(intelTableGolden, []);
    expect(Array.isArray(proposals)).toBe(true);
  });

  it('OQ-13 go/no-go 判定:go(同 DSL 跨族可用;v1.1 深化后仍 go)', () => {
    // 判定逻辑:Contract 加载 + 编译 + Scorer 跑通 + bug 被抓 = go
    // v1.1 升级后谓词/rubric 扩容,但 go 判定标准不变(能加载+编译+抓 bug+golden 干净)
    const loadsOk = contract.artifact_family === 'table';
    const compilesOk = scorer.deterministicPredicateCount >= 3 && scorer.deterministicRubricCount >= 3;
    const bugsCaught = scorer.score(intelTableBuggy).deterministic.hard_violation_count === 3;
    const goldenClean = scorer.score(intelTableGolden).deterministic.hard_violation_count === 0;

    const verdict = (loadsOk && compilesOk && bugsCaught && goldenClean) ? 'go' : 'no-go';
    expect(verdict).toBe('go');
    console.log('[OQ-13] cross-family probe verdict:', verdict);
  });
});
