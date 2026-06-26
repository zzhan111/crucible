import type { Artifact, Predicate, Violation } from './types.js';

const CLEARING_TYPES = new Set(['switch', 'buffer']);

/**
 * makeStateMutex: 工厂,接收 mutex token 列表,返回 Predicate。
 *
 * P1 升级(eng-review A2 技术债偿还):
 * - 同节点互斥:同一节点内不能同时持有两个 mutex token(P0 已有,保留)
 * - 相邻节点互斥:相邻节点不能分别持有互斥 token,除非中间有 clearing transition(switch/buffer)
 *   例如:节点 0 持有 luggage_drop,节点 1 持有 depart_from_hotel → 违规(先寄存后出发,互斥)
 *   除非节点 0 和 1 之间有 switch/buffer 清除 state
 *
 * 注(outside-voice #12):签名用 string[] 而非 tuple,Contract YAML 的 mutex 字段是数组。
 * P1 仍只取前 2 个检查。
 */
export function makeStateMutex(mutexTokens: string[]): Predicate {
  if (mutexTokens.length < 2) {
    return () => [];
  }
  const a = mutexTokens[0];
  const b = mutexTokens[1];
  return (artifact: Artifact): Violation[] => {
    const violations: Violation[] = [];
    const nodes = artifact.nodes;

    // 检查 1:同节点互斥(P0 保留)
    nodes.forEach((node, idx) => {
      const states = Array.isArray(node.state) ? node.state.map(String) : [];
      if (states.includes(a) && states.includes(b)) {
        violations.push({
          constraint_id: 'state_mutex',
          severity: 'hard',
          message: `node ${idx} holds both mutex states: ${a} and ${b}`,
          location: { node_index: idx, field: 'state' },
          fix_hint: `remove one of ${a}/${b} from this node, or split into two nodes with a clearing transition`,
        });
      }
    });

    // 检查 2:相邻节点互斥(P1 新增)
    for (let i = 0; i < nodes.length - 1; i++) {
      const nodeA = nodes[i];
      const nodeB = nodes[i + 1];
      const aClears = CLEARING_TYPES.has(String(nodeA.node_type ?? ''));
      const bClears = CLEARING_TYPES.has(String(nodeB.node_type ?? ''));
      if (aClears || bClears) continue; // 有 clearing,不检查

      const statesA = new Set(Array.isArray(nodeA.state) ? nodeA.state.map(String) : []);
      const statesB = new Set(Array.isArray(nodeB.state) ? nodeB.state.map(String) : []);

      // 节点 A 持有 a,节点 B 持有 b(或反过来)
      if ((statesA.has(a) && statesB.has(b)) || (statesA.has(b) && statesB.has(a))) {
        violations.push({
          constraint_id: 'state_mutex',
          severity: 'hard',
          message: `adjacent nodes ${i} and ${i + 1} hold mutex states across nodes: ${a} and ${b}`,
          location: { node_index: i, node_index_end: i + 1, field: 'state' },
          fix_hint: `insert a switch/buffer node between them, or remove one mutex state`,
        });
      }
    }

    return violations;
  };
}
