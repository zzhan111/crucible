import type { Artifact, Predicate, Violation } from './types.js';

const BRIDGE_TYPES = new Set(['transit', 'switch']);

/**
 * continuity: 每对相邻节点之间,必须有 transit 或 switch。
 * 算法:遍历相邻节点对 (i, i+1),如果两个都不是 transit/switch,则违规。
 * 注:相邻两节点只要任一是 transit/switch 即不违规,transit 不要求成对出现。
 *     例如 dining→transit→dining 合法(dining 之间隔了一个 transit 桥)。
 */
export const continuity: Predicate = (artifact: Artifact): Violation[] => {
  const violations: Violation[] = [];
  const nodes = artifact.nodes;
  for (let i = 0; i < nodes.length - 1; i++) {
    const a = nodes[i];
    const b = nodes[i + 1];
    const aIsBridge = BRIDGE_TYPES.has(String(a.node_type ?? ''));
    const bIsBridge = BRIDGE_TYPES.has(String(b.node_type ?? ''));
    if (!aIsBridge && !bIsBridge) {
      violations.push({
        constraint_id: 'continuity',
        severity: 'hard',
        message: `adjacent nodes at index ${i} and ${i + 1} have no transit/switch bridge between them`,
        location: { node_index: i, node_index_end: i + 1 },
        fix_hint: 'insert a transit or switch node between these two nodes',
      });
    }
  }
  return violations;
};
