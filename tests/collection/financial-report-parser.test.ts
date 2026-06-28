import { describe, it, expect } from 'vitest';
import { parseFinancialReport } from '../../src/collection/financial-report-parser.js';
import { publicReportSample, publicReportTaxFlagSample } from '../../src/fixtures/public-report-sample.js';
import { compileContract } from '../../src/contract/compiler.js';
import { loadContract } from '../../src/contract/validate.js';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONTRACT = join(__dirname, '..', '..', 'contracts', 'financial-v1.yaml');

describe('P4.3 公开财报解析器(JSON → financial artifact)', () => {
  it('解析出 financial family artifact + 正确 metadata', () => {
    const art = parseFinancialReport(publicReportSample);
    expect(art.family).toBe('financial');
    expect(art.metadata?.company).toBe('DemoListed Corp');
    expect(art.metadata?.fiscal_year).toBe(2025);
    expect(art.metadata?.currency).toBe('CNY');
    expect(art.metadata?.audit_status).toBe('audited');
  });

  it('三大报表行项都进 nodes(line_item + section + amount)', () => {
    const art = parseFinancialReport(publicReportSample);
    // income_statement 5 + balance_sheet 4 + cash_flow 1 = 10
    expect(art.nodes).toHaveLength(10);
    const sections = new Set(art.nodes.map(n => n.section));
    expect(sections).toEqual(new Set(['income_statement', 'balance_sheet', 'cash_flow']));
    const revenue = art.nodes.find(n => n.line_item === 'revenue');
    expect(revenue?.amount).toBe(12500000);
    expect(revenue?.section).toBe('income_statement');
  });

  it('source_trust 按审计状态赋值(audited=0.95)', () => {
    const art = parseFinancialReport(publicReportSample);
    for (const n of art.nodes) {
      expect(n.source_trust).toBeCloseTo(0.95, 2);
      expect(n.source).toBe('edgar-10K-2025.json');
    }
  });

  it('reviewed 审计状态 → source_trust 0.70', () => {
    const art = parseFinancialReport(publicReportTaxFlagSample);
    expect(art.metadata?.audit_status).toBe('reviewed');
    expect(art.nodes[0].source_trust).toBeCloseTo(0.70, 2);
  });

  it('解析后的 artifact 可被 financial contract 打分', () => {
    const scorer = compileContract(loadContract(CONTRACT));
    const clean = scorer.score(parseFinancialReport(publicReportSample));
    expect(clean.deterministic.hard_violation_count).toBe(0); // 干净样例无红旗

    const flagged = scorer.score(parseFinancialReport(publicReportTaxFlagSample));
    expect(flagged.deterministic.hard_violation_count).toBeGreaterThanOrEqual(1);
    expect(flagged.deterministic.violations.some(v => v.constraint_id === 'tax_ratio_floor')).toBe(true);
  });
});
