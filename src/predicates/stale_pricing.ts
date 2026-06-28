import type { Artifact, Violation } from '../predicates/types.js';

/**
 * stalePricing (P4.6 §1):last_verified 超过阈值(默认 180 天)→ hard 违规。
 *
 * 监测场景下"陈旧定价"意味着情报已不可信(竞品可能已调价/下架),
 * 必须重新核验。这与 freshness rubric(soft 评分)互补:
 *   freshness 给分,但 staleness 是硬门槛(超期即不可用)。
 *
 * 默认阈值 180 天可由 contract 调整(传入 max_age_days)。
 * 参考日期沿用 freshness.ts 的 2026-06-25 固定值(避免时间依赖)。
 *
 * 适用于 table 族(情报表)。
 */
const REFERENCE_DATE = new Date('2026-06-25');
const DEFAULT_MAX_AGE_DAYS = 180;

export function makeStalePricing(maxAgeDays: number = DEFAULT_MAX_AGE_DAYS) {
  return function stalePricing(artifact: Artifact): Violation[] {
    const violations: Violation[] = [];
    artifact.nodes.forEach((node, i) => {
      const lv = node.last_verified;
      if (lv === undefined || lv === null || String(lv).trim() === '') {
        // 缺 last_verified 由 no_empty_source / coverage 覆盖,这里只看陈旧
        return;
      }
      const date = new Date(String(lv));
      if (isNaN(date.getTime())) return;
      const daysAgo = Math.floor((REFERENCE_DATE.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
      if (daysAgo > maxAgeDays) {
        violations.push({
          constraint_id: 'stale_pricing',
          severity: 'hard',
          message: `row ${i} last_verified=${String(lv)} 已陈旧(${daysAgo}天 > ${maxAgeDays}天阈值,定价可能失效)`,
          location: { node_index: i, field: 'last_verified' },
          fix_hint: `重新核验该竞品定价并更新 last_verified(当前已过期 ${daysAgo - maxAgeDays} 天)`,
        });
      }
    });
    return violations;
  };
}

/** 默认 180 天阈值版本(对应 contract 不传参时) */
export const stalePricing = makeStalePricing();
