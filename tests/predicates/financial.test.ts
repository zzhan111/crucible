import { describe, it, expect } from 'vitest';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadContract } from '../../src/contract/validate.js';
import { compileContract } from '../../src/contract/compiler.js';
import {
  financialGolden,
  financialTaxFlag,
  financialCashflowFlag,
  financialRelatedPartyFlag,
} from '../../src/fixtures/financial-dd.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONTRACT = join(__dirname, '..', '..', 'contracts', 'financial-v1.yaml');

/** 编译财务契约的 scorer(测前共享) */
function makeScorer() {
  return compileContract(loadContract(CONTRACT));
}

describe('P4.3 财务尽调红旗谓词(经 code_predicate 沙箱)', () => {
  it('干净档案 → 0 硬违规', () => {
    const r = makeScorer().score(financialGolden);
    expect(r.deterministic.hard_violation_count).toBe(0);
    expect(r.deterministic.violations).toEqual([]);
  });

  it('tax_ratio_floor:有效税率 3% → 触发偷漏税红旗', () => {
    const r = makeScorer().score(financialTaxFlag);
    expect(r.deterministic.hard_violation_count).toBeGreaterThanOrEqual(1);
    const v = r.deterministic.violations.find(x => x.constraint_id === 'tax_ratio_floor');
    expect(v).toBeDefined();
    expect(v!.severity).toBe('hard');
    expect(v!.message).toContain('3.0%');
    expect(v!.location.field).toBe('tax_expense');
  });

  it('cashflow_anomaly:OCF/NI = 0.22 → 触发现金流红旗', () => {
    const r = makeScorer().score(financialCashflowFlag);
    expect(r.deterministic.hard_violation_count).toBeGreaterThanOrEqual(1);
    const v = r.deterministic.violations.find(x => x.constraint_id === 'cashflow_anomaly');
    expect(v).toBeDefined();
    expect(v!.message).toContain('0.22');
    expect(v!.location.field).toBe('operating_cashflow');
  });

  it('related_party_transfer:关联收入 45% 未披露 → 触发转移定价红旗', () => {
    const r = makeScorer().score(financialRelatedPartyFlag);
    expect(r.deterministic.hard_violation_count).toBeGreaterThanOrEqual(1);
    const v = r.deterministic.violations.find(x => x.constraint_id === 'related_party_transfer');
    expect(v).toBeDefined();
    expect(v!.message).toContain('45%');
    expect(v!.location.field).toBe('related_party');
  });

  it('硬违规惩罚降低 det_score(红旗档案分 < 干净档案分)', () => {
    const s = makeScorer();
    const clean = s.score(financialGolden).deterministic.deterministic_score;
    const flagged = s.score(financialTaxFlag).deterministic.deterministic_score;
    expect(flagged).toBeLessThan(clean);
  });

  it('ratio_health rubric 运行:干净档案健康分高', () => {
    const r = makeScorer().score(financialGolden);
    const rh = r.deterministic.rubric_scores.find(x => x.dim === 'ratio_health');
    expect(rh).toBeDefined();
    expect(rh!.mode).toBe('deterministic');
    expect(rh!.score).toBeGreaterThan(0.8);
    expect(rh!.rationale).toContain('current');
  });

  it('source_trust 区分审计质量(audited 0.95 > reviewed 0.7)', () => {
    const s = makeScorer();
    const audited = s.score(financialGolden).deterministic.rubric_scores.find(x => x.dim === 'source_trust')!.score;
    const reviewed = s.score(financialTaxFlag).deterministic.rubric_scores.find(x => x.dim === 'source_trust')!.score;
    expect(audited).toBeGreaterThan(reviewed);
    expect(audited).toBeCloseTo(0.95, 2);
    expect(reviewed).toBeCloseTo(0.70, 2);
  });
});
