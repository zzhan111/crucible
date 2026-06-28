/**
 * P4.3 §6 — 公开财报解析器(JSON → financial artifact)。
 *
 * 把简化 JSON 财报(PublicReportInput)解析为 Crucible financial artifact,
 * 供 contract 打分 + 红旗筛查。这是"公开财报补真例"路径 — 真实落地时
 * 替换为 SEC EDGAR / 巨潮资讯 JSON 解析(结构类似)。
 *
 * source_trust 赋值规则(审计质量映射,复用 source_trust rubric 语义):
 * - audited   → 0.95(经审计,最高信任)
 * - reviewed  → 0.70(审阅,中等)
 * - unaudited → 0.30(未审计,低信任)
 * 公开数据本身 +0.0(公开≠可信,审计状态才决定信任)。
 *
 * spec ref: P4.3 plan §6;PRD §6 审计轨迹(出处+分数)
 */
import type { Artifact } from '../predicates/types.js';
import type { PublicReportInput } from '../fixtures/public-report-sample.js';

const AUDIT_TRUST: Record<PublicReportInput['audit_status'], number> = {
  audited: 0.95,
  reviewed: 0.70,
  unaudited: 0.30,
};

/**
 * 解析公开财报 JSON 为 financial artifact。
 * 三大报表(income_statement/balance_sheet/cash_flow)的 line_item → artifact.nodes,
 * 每行带 section/source/source_trust/period。
 */
export function parseFinancialReport(report: PublicReportInput): Artifact {
  const trust = AUDIT_TRUST[report.audit_status] ?? 0.5;
  const period = `FY${report.fiscal_year}`;

  const toNodes = (section: string, items: Record<string, number>) =>
    Object.entries(items).map(([line_item, amount]) => ({
      line_item,
      amount,
      section,
      source: report.source,
      source_trust: trust,
      period,
    }));

  return {
    family: 'financial',
    metadata: {
      fiscal_year: report.fiscal_year,
      currency: report.currency,
      audit_status: report.audit_status,
      company: report.company,
    },
    nodes: [
      ...toNodes('income_statement', report.income_statement),
      ...toNodes('balance_sheet', report.balance_sheet),
      ...toNodes('cash_flow', report.cash_flow),
    ],
  };
}
