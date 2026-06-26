import type { Artifact, Violation } from '../predicates/types.js';

/**
 * noDuplicateCompetitor (P1 §2.8 跨族探针):competitor_name 不能重复。
 * 适用于 table 族(情报表),每个节点 = 一行竞品数据。
 */
export function noDuplicateCompetitor(artifact: Artifact): Violation[] {
  const violations: Violation[] = [];
  const seen = new Map<string, number>(); // name → first index
  artifact.nodes.forEach((node, i) => {
    const name = node.competitor_name;
    if (name === undefined || name === null) return; // missing name 不报这个约束
    const nameStr = String(name).trim();
    if (nameStr === '') return;
    if (seen.has(nameStr)) {
      violations.push({
        constraint_id: 'no_duplicate_competitor',
        severity: 'hard',
        message: `competitor "${nameStr}" duplicated (first at row ${seen.get(nameStr)})`,
        location: { node_index: seen.get(nameStr), node_index_end: i, field: 'competitor_name' },
        fix_hint: `remove duplicate entry for "${nameStr}" or merge features`,
      });
    } else {
      seen.set(nameStr, i);
    }
  });
  return violations;
}
