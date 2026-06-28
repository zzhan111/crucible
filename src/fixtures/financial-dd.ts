/**
 * P4.3 财务尽调 vertical — 合成财务档案(黄金 + 3 红旗)。
 *
 * ⚠️ 合成数据,非真实企业。用于建契约 + 校准黄金集 + demo。
 *   真实落地走 on-prem 客户自带数据(PRD §5 引擎开源/契约私有)。
 *
 * 每份档案:income_statement + balance_sheet + cash_flow 的 line_item 节点。
 * nodes 字段:line_item / amount / section / source / source_trust / period(红旗档案加 related_party/disclosed)。
 *
 * spec ref: P4.3 plan §4;仿 intel-table.ts 黄金/红旗对模式
 */
import type { Artifact } from '../predicates/types.js';

/**
 * 干净档案(黄金基线):税率正常(25%)、现金流健康、无关联方、比率达标,审计状态 audited。
 * 应触发 0 硬违规,source_trust 高。
 */
export const financialGolden: Artifact = {
  family: 'financial',
  metadata: { fiscal_year: 2025, currency: 'CNY', audit_status: 'audited', company: 'SampleCo Ltd' },
  nodes: [
    // income_statement
    { line_item: 'revenue', amount: 12500000, section: 'income_statement', source: '10K_audit.pdf', source_trust: 0.95, period: 'FY2025' },
    { line_item: 'cogs', amount: 5000000, section: 'income_statement', source: '10K_audit.pdf', source_trust: 0.95, period: 'FY2025' },
    { line_item: 'pre_tax_profit', amount: 3000000, section: 'income_statement', source: '10K_audit.pdf', source_trust: 0.95, period: 'FY2025' },
    { line_item: 'tax_expense', amount: 750000, section: 'income_statement', source: '10K_audit.pdf', source_trust: 0.95, period: 'FY2025' }, // 25% 税率,正常
    { line_item: 'net_income', amount: 2250000, section: 'income_statement', source: '10K_audit.pdf', source_trust: 0.95, period: 'FY2025' },
    // balance_sheet
    { line_item: 'current_assets', amount: 4000000, section: 'balance_sheet', source: '10K_audit.pdf', source_trust: 0.95, period: 'FY2025' },
    { line_item: 'current_liabilities', amount: 2000000, section: 'balance_sheet', source: '10K_audit.pdf', source_trust: 0.95, period: 'FY2025' },
    { line_item: 'total_liabilities', amount: 3000000, section: 'balance_sheet', source: '10K_audit.pdf', source_trust: 0.95, period: 'FY2025' },
    { line_item: 'total_assets', amount: 10000000, section: 'balance_sheet', source: '10K_audit.pdf', source_trust: 0.95, period: 'FY2025' }, // 负债率 30%,健康
    // cash_flow
    { line_item: 'operating_cashflow', amount: 2000000, section: 'cash_flow', source: '10K_audit.pdf', source_trust: 0.95, period: 'FY2025' }, // OCF/NI = 0.89,健康
  ],
};

/**
 * 偷漏税红旗:税率 3%(tax_expense 90000 / pre_tax_profit 3000000),其他正常。
 * 应触发 tax_ratio_floor 红旗。
 */
export const financialTaxFlag: Artifact = {
  family: 'financial',
  metadata: { fiscal_year: 2025, currency: 'CNY', audit_status: 'reviewed', company: 'SampleCo Ltd' },
  nodes: [
    { line_item: 'revenue', amount: 12500000, section: 'income_statement', source: '10K_review.pdf', source_trust: 0.7, period: 'FY2025' },
    { line_item: 'cogs', amount: 5000000, section: 'income_statement', source: '10K_review.pdf', source_trust: 0.7, period: 'FY2025' },
    { line_item: 'pre_tax_profit', amount: 3000000, section: 'income_statement', source: '10K_review.pdf', source_trust: 0.7, period: 'FY2025' },
    { line_item: 'tax_expense', amount: 90000, section: 'income_statement', source: '10K_review.pdf', source_trust: 0.7, period: 'FY2025' }, // 3% 税率,红旗
    { line_item: 'net_income', amount: 2910000, section: 'income_statement', source: '10K_review.pdf', source_trust: 0.7, period: 'FY2025' },
    { line_item: 'current_assets', amount: 4000000, section: 'balance_sheet', source: '10K_review.pdf', source_trust: 0.7, period: 'FY2025' },
    { line_item: 'current_liabilities', amount: 2000000, section: 'balance_sheet', source: '10K_review.pdf', source_trust: 0.7, period: 'FY2025' },
    { line_item: 'total_liabilities', amount: 3000000, section: 'balance_sheet', source: '10K_review.pdf', source_trust: 0.7, period: 'FY2025' },
    { line_item: 'total_assets', amount: 10000000, section: 'balance_sheet', source: '10K_review.pdf', source_trust: 0.7, period: 'FY2025' },
    { line_item: 'operating_cashflow', amount: 2000000, section: 'cash_flow', source: '10K_review.pdf', source_trust: 0.7, period: 'FY2025' },
  ],
};

/**
 * 现金流红旗:经营现金流 500000 / 净利润 2250000 = 0.22(< 0.5),其他正常。
 * 应触发 cashflow_anomaly 红旗。
 */
export const financialCashflowFlag: Artifact = {
  family: 'financial',
  metadata: { fiscal_year: 2025, currency: 'CNY', audit_status: 'audited', company: 'SampleCo Ltd' },
  nodes: [
    { line_item: 'revenue', amount: 12500000, section: 'income_statement', source: '10K_audit.pdf', source_trust: 0.95, period: 'FY2025' },
    { line_item: 'cogs', amount: 5000000, section: 'income_statement', source: '10K_audit.pdf', source_trust: 0.95, period: 'FY2025' },
    { line_item: 'pre_tax_profit', amount: 3000000, section: 'income_statement', source: '10K_audit.pdf', source_trust: 0.95, period: 'FY2025' },
    { line_item: 'tax_expense', amount: 750000, section: 'income_statement', source: '10K_audit.pdf', source_trust: 0.95, period: 'FY2025' },
    { line_item: 'net_income', amount: 2250000, section: 'income_statement', source: '10K_audit.pdf', source_trust: 0.95, period: 'FY2025' },
    { line_item: 'current_assets', amount: 4000000, section: 'balance_sheet', source: '10K_audit.pdf', source_trust: 0.95, period: 'FY2025' },
    { line_item: 'current_liabilities', amount: 2000000, section: 'balance_sheet', source: '10K_audit.pdf', source_trust: 0.95, period: 'FY2025' },
    { line_item: 'total_liabilities', amount: 3000000, section: 'balance_sheet', source: '10K_audit.pdf', source_trust: 0.95, period: 'FY2025' },
    { line_item: 'total_assets', amount: 10000000, section: 'balance_sheet', source: '10K_audit.pdf', source_trust: 0.95, period: 'FY2025' },
    { line_item: 'operating_cashflow', amount: 500000, section: 'cash_flow', source: '10K_audit.pdf', source_trust: 0.95, period: 'FY2025' }, // OCF/NI = 0.22,红旗
  ],
};

/**
 * 关联方红旗:收入中 45% 来自关联方且未披露(disclosed != 'yes'),其他比率正常。
 * 应触发 related_party_transfer 红旗。
 */
export const financialRelatedPartyFlag: Artifact = {
  family: 'financial',
  metadata: { fiscal_year: 2025, currency: 'CNY', audit_status: 'reviewed', company: 'SampleCo Ltd' },
  nodes: [
    // 收入拆两行:一行普通收入,一行关联方收入(未披露)
    { line_item: 'revenue', amount: 6875000, section: 'income_statement', source: 'mgmt_report.xlsx', source_trust: 0.5, period: 'FY2025' },
    { line_item: 'revenue', amount: 5625000, section: 'income_statement', source: 'mgmt_report.xlsx', source_trust: 0.5, period: 'FY2025', related_party: 'ParentCo', disclosed: 'no' }, // 45% 关联,未披露
    { line_item: 'cogs', amount: 5000000, section: 'income_statement', source: 'mgmt_report.xlsx', source_trust: 0.5, period: 'FY2025' },
    { line_item: 'pre_tax_profit', amount: 3000000, section: 'income_statement', source: 'mgmt_report.xlsx', source_trust: 0.5, period: 'FY2025' },
    { line_item: 'tax_expense', amount: 750000, section: 'income_statement', source: 'mgmt_report.xlsx', source_trust: 0.5, period: 'FY2025' },
    { line_item: 'net_income', amount: 2250000, section: 'income_statement', source: 'mgmt_report.xlsx', source_trust: 0.5, period: 'FY2025' },
    { line_item: 'current_assets', amount: 4000000, section: 'balance_sheet', source: 'mgmt_report.xlsx', source_trust: 0.5, period: 'FY2025' },
    { line_item: 'current_liabilities', amount: 2000000, section: 'balance_sheet', source: 'mgmt_report.xlsx', source_trust: 0.5, period: 'FY2025' },
    { line_item: 'total_liabilities', amount: 3000000, section: 'balance_sheet', source: 'mgmt_report.xlsx', source_trust: 0.5, period: 'FY2025' },
    { line_item: 'total_assets', amount: 10000000, section: 'balance_sheet', source: 'mgmt_report.xlsx', source_trust: 0.5, period: 'FY2025' },
    { line_item: 'operating_cashflow', amount: 2000000, section: 'cash_flow', source: 'mgmt_report.xlsx', source_trust: 0.5, period: 'FY2025' },
  ],
};
