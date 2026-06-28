/**
 * P4.3 §6 — 公开财报样例数据(简化,非真实企业)。
 *
 * ⚠️ 这是基于公开年报**结构**手造的样例,不是抓取真实企业数据。
 *   避免数据合法性问题;真实落地时替换为 SEC EDGAR / 巨潮资讯 JSON。
 *   数据规模与结构参照上市公司年报口径(万元),但公司与数字均为虚构。
 *
 * spec ref: P4.3 plan §6;PRD §5 引擎开源/契约私有(真实数据走 on-prem)
 */

/** 公开财报 JSON 输入格式(简化:公司元数据 + 三大报表行项) */
export interface PublicReportInput {
  company: string;
  fiscal_year: number;
  currency: string;
  audit_status: 'audited' | 'reviewed' | 'unaudited';
  source: string;          // 来源(如 'edgar-10K-2025.json')
  income_statement: Record<string, number>;  // line_item → amount
  balance_sheet: Record<string, number>;
  cash_flow: Record<string, number>;
}

/**
 * 样例:一家"干净"的虚构上市公司年报(税率正常、现金流健康、比率达标)。
 * 规模参照中型上市公司(单位:万元)。可作 parser 输入,产出 financialGolden 等价 artifact。
 */
export const publicReportSample: PublicReportInput = {
  company: 'DemoListed Corp',
  fiscal_year: 2025,
  currency: 'CNY',
  audit_status: 'audited',
  source: 'edgar-10K-2025.json',
  income_statement: {
    revenue: 12500000,
    cogs: 5000000,
    pre_tax_profit: 3000000,
    tax_expense: 750000,
    net_income: 2250000,
  },
  balance_sheet: {
    current_assets: 4000000,
    current_liabilities: 2000000,
    total_liabilities: 3000000,
    total_assets: 10000000,
  },
  cash_flow: {
    operating_cashflow: 2000000,
  },
};

/**
 * 样例:一家"税务红旗"的虚构上市公司(有效税率 4%)。
 * 用于演示 parser → 红旗筛查闭环(真实公开数据也可能含红旗)。
 */
export const publicReportTaxFlagSample: PublicReportInput = {
  company: 'DemoListed Corp B',
  fiscal_year: 2025,
  currency: 'CNY',
  audit_status: 'reviewed',
  source: 'edgar-10K-2025b.json',
  income_statement: {
    revenue: 12500000,
    cogs: 5000000,
    pre_tax_profit: 3000000,
    tax_expense: 120000,  // 4% 有效税率,红旗
    net_income: 2880000,
  },
  balance_sheet: {
    current_assets: 4000000,
    current_liabilities: 2000000,
    total_liabilities: 3000000,
    total_assets: 10000000,
  },
  cash_flow: {
    operating_cashflow: 2000000,
  },
};
