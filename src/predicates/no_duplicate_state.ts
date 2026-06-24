import type { Artifact, Predicate, Violation } from './types.js';

const CLEARING_TYPES = new Set(['switch', 'buffer']);

/**
 * noDuplicateState: 同一 state token 不能连续两节点出现,除非中间有 switch/buffer 清除。
 * 算法:遍历相邻节点对 (i, i+1),若两节点都持某 state token 且两节点都不是 clearing type,违规。
 */
export const noDuplicateState: Predicate = (artifact: Artifact): Violation[] => {
  const violations: Violation[] = [];
  const nodes = artifact.nodes;
  for (let i = 0; i < nodes.length - 1; i++) {
    const a = nodes[i];
    const b = nodes[i + 1];
    const aClears = CLEARING_TYPES.has(String(a.node_type ?? ''));
    const bClears = CLEARING_TYPES.has(String(b.node_type ?? ''));
    if (aClears || bClears) continue;
    const aStates = new Set(Array.isArray(a.state) ? a.state.map(String) : []);
    const bStates = Array.isArray(b.state) ? b.state.map(String) : [];
    for (const s of bStates) {
      if (aStates.has(s)) {
        violations.push({
          constraint_id: 'no_duplicate_state',
          severity: 'hard',
          message: `state "${s}" persists across consecutive nodes ${i} and ${i + 1} without a clearing transition`,
          location: { node_index: i, node_index_end: i + 1, field: 'state' },
          fix_hint: 'insert a switch or buffer node between them, or remove the duplicate state',
        });
      }
    }
  }
  return violations;
};
