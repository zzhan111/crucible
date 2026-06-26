import type { Artifact, Violation } from '../predicates/types.js';

/**
 * no_empty_source (P1 §2.8 跨族探针):每行必须有非空 source 字段。
 * 适用于 table 族(情报表),每个节点 = 一行竞品数据。
 */
export function noEmptySource(artifact: Artifact): Violation[] {
  const violations: Violation[] = [];
  artifact.nodes.forEach((node, i) => {
    const source = node.source;
    if (source === undefined || source === null || String(source).trim() === '') {
      violations.push({
        constraint_id: 'no_empty_source',
        severity: 'hard',
        message: `row ${i} has empty source field`,
        location: { node_index: i, field: 'source' },
        fix_hint: 'add a source URL or reference for this competitor data',
      });
    }
  });
  return violations;
}
