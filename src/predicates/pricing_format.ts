import type { Artifact, Violation } from '../predicates/types.js';

/**
 * pricingFormat (P1 §2.8 跨族探针):pricing 字段必须含数字或"免费",
 * 不能是空/未知/N/A。
 * 适用于 table 族(情报表)。
 */
export function pricingFormat(artifact: Artifact): Violation[] {
  const violations: Violation[] = [];
  artifact.nodes.forEach((node, i) => {
    const pricing = node.pricing;
    if (pricing === undefined || pricing === null) {
      violations.push({
        constraint_id: 'pricing_format',
        severity: 'hard',
        message: `row ${i} has missing pricing field`,
        location: { node_index: i, field: 'pricing' },
        fix_hint: 'add pricing (number, range, or "免费")',
      });
      return;
    }
    const p = String(pricing).trim();
    if (p === '' || /^未知|n\/?a|无$/i.test(p)) {
      violations.push({
        constraint_id: 'pricing_format',
        severity: 'hard',
        message: `row ${i} pricing is empty/unknown: "${p}"`,
        location: { node_index: i, field: 'pricing' },
        fix_hint: 'replace with actual pricing (number, range, or "免费")',
      });
      return;
    }
    // 必须含数字 或 "免费"
    if (!/\d/.test(p) && !/免费/.test(p)) {
      violations.push({
        constraint_id: 'pricing_format',
        severity: 'hard',
        message: `row ${i} pricing has no number or "免费": "${p}"`,
        location: { node_index: i, field: 'pricing' },
        fix_hint: 'pricing must contain a number or "免费"',
      });
    }
  });
  return violations;
}
