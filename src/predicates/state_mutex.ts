import type { Artifact, Predicate, Violation } from './types.js';

/**
 * makeStateMutex: 工厂,接收 mutex token 列表,返回 Predicate。
 * 规则:同一节点内不能同时持有两个 mutex token。
 * P0 只检查同节点互斥。相邻节点互斥留 P1。
 *
 * 注(outside-voice #12):签名用 string[] 而非 [string, string] tuple,
 * 因为 Contract YAML 的 mutex 字段是数组,可能含 2+ token。
 * P0 只取前 2 个检查(见 compiler 调用处),多于 2 个的 token 在 P0 被忽略。
 *
 * 技术债(eng-review A2):P0 只检查同节点互斥。PRD §6 原意是"相邻节点互斥"——
 * 真实旅游里 luggage_drop 和 depart_from_hotel 出现在相邻节点(先寄存后出发),
 * 而非同一节点。P0 buggy fixture 被迫把两个 state 塞同一节点触发违规,demo 真实性打折。
 * P1 升级路径:定义 clearing transition 语义(node_type 为 switch/buffer 清除 state),
 * 实现相邻节点互斥检查,重做 fixture 让 bug 贴近 q-traveller §7 真实场景。
 */
export function makeStateMutex(mutexTokens: string[]): Predicate {
  if (mutexTokens.length < 2) {
    return () => []; // 不足 2 个 token,无法构成互斥对,返回 noop
  }
  const a = mutexTokens[0];
  const b = mutexTokens[1];
  return (artifact: Artifact): Violation[] => {
    const violations: Violation[] = [];
    artifact.nodes.forEach((node, idx) => {
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
    return violations;
  };
}
