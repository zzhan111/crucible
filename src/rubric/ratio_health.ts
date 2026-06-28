import type { Artifact } from '../predicates/types.js';
import type { DeterministicRubric, RubricScore } from './types.js';

/**
 * ratioHealth (deterministic, P4.3 财务尽调):综合财务比率健康度。
 *
 * 读 income_statement / balance_sheet / cash_flow 的 line_item amount,
 * 算 3 个比率,各归一化到 [0,1] 后等权平均:
 * - 流动比率 current_ratio = current_assets / current_liabilities(2.0 为健康基准)
 * - 资产负债率 debt_ratio = total_liabilities / total_assets(0.5 为健康,>0.85 红线)
 * - 毛利率 gross_margin = (revenue - cogs) / revenue(越高越好,0.3 为中性)
 *
 * 缺数据按 0.5(中性)计。这是"比率健康"维度的分,不替代硬约束(比率越界由 ratio_breach 谓词标红旗)。
 */
export const ratioHealth: DeterministicRubric = (artifact: Artifact): RubricScore => {
  // 按 line_item 名聚合 amount(同 line_item 多期取最新一行)
  const byItem = new Map<string, number>();
  for (const node of artifact.nodes) {
    const item = node.line_item;
    const amt = node.amount;
    if (typeof item === 'string' && typeof amt === 'number' && !Number.isNaN(amt)) {
      byItem.set(item, amt); // 后出现的覆盖(假设按期排序,最新在后)
    }
  }

  const get = (k: string): number | undefined => {
    const v = byItem.get(k);
    return v === undefined ? undefined : v;
  };

  // 1. 流动比率(2.0 健康 → 1.0;偏离双向扣分)
  let currentScore = 0.5;
  const ca = get('current_assets'), cl = get('current_liabilities');
  if (ca !== undefined && cl !== undefined && cl !== 0) {
    const cr = ca / cl;
    // 2.0 = 1.0;<1 或 >4 衰减到 0.2;线性插值
    if (cr >= 1.5 && cr <= 2.5) currentScore = 1.0;
    else if (cr < 1) currentScore = 0.2;
    else currentScore = Math.max(0.2, 1.0 - Math.abs(cr - 2.0) * 0.3);
  }

  // 2. 资产负债率(0.5 健康 → 1.0;>0.85 红线 → 低分)
  let debtScore = 0.5;
  const tl = get('total_liabilities'), ta = get('total_assets');
  if (tl !== undefined && ta !== undefined && ta !== 0) {
    const dr = tl / ta;
    if (dr <= 0.5) debtScore = 1.0;
    else if (dr >= 0.85) debtScore = 0.1;
    else debtScore = Math.max(0.1, 1.0 - (dr - 0.5) * 2.7); // 0.5→1.0, 0.85→0.1
  }

  // 3. 毛利率(0.3 中性 → 0.5;越高越好)
  let marginScore = 0.5;
  const rev = get('revenue'), cogs = get('cogs');
  if (rev !== undefined && cogs !== undefined && rev !== 0) {
    const gm = (rev - cogs) / rev;
    if (gm <= 0) marginScore = 0.1;
    else marginScore = Math.min(1.0, 0.2 + gm * 1.6); // 0.3→0.68, 0.5→1.0
  }

  const score = (currentScore + debtScore + marginScore) / 3;
  const reasons: string[] = [];
  if (ca !== undefined && cl !== undefined) reasons.push(`current=${(ca / (cl || 1)).toFixed(2)}`);
  if (tl !== undefined && ta !== undefined) reasons.push(`debt=${(tl / (ta || 1)).toFixed(2)}`);
  if (rev !== undefined && cogs !== undefined) reasons.push(`margin=${(((rev - cogs) / (rev || 1)) * 100).toFixed(0)}%`);

  return {
    dim: 'ratio_health',
    score: Math.max(0, Math.min(1, score)),
    mode: 'deterministic',
    rationale: reasons.length > 0 ? `ratios: ${reasons.join(', ')}` : 'insufficient data (neutral)',
  };
};
