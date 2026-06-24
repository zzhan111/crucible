import type { Artifact, Violation } from '../predicates/types.js';
import type { ScoreReport } from '../scorer/types.js';
import type { ArtifactPatch } from '../patch/types.js';

/**
 * Critic: 读 ScoreReport + Violations,生成提分 patch。
 * 策略(P0 确定性,不调 LLM):
 * - continuity 违规 → insert transit 节点
 * - state_mutex 违规 → update_field state,移除第二个 mutex token
 * - no_duplicate_state 违规 → update_field state,清除重复 token
 * - judge 低分维度 → P0 不处理,只处理硬约束
 */
export async function generatePatches(
  report: ScoreReport,
  artifact: Artifact
): Promise<ArtifactPatch[]> {
  console.log('[Critic] analyzing violations for patches');
  const patches: ArtifactPatch[] = [];
  const violations = report.deterministic.violations;

  for (const v of violations) {
    switch (v.constraint_id) {
      case 'continuity': {
        const afterIdx = v.location.node_index ?? 0;
        patches.push({
          type: 'insert',
          after_index: afterIdx,
          node: {
            action: '步行/交通衔接(自动补丁)',
            node_type: 'transit',
            duration_min: 15,
            elasticity: 'non_compressible',
            cost: 10,
            state: [],
          },
          reason: `fix continuity violation at nodes ${v.location.node_index}-${v.location.node_index_end}`,
        });
        break;
      }
      case 'state_mutex': {
        const idx = v.location.node_index ?? 0;
        const node = artifact.nodes[idx];
        const states = Array.isArray(node?.state) ? node.state.map(String) : [];
        const mutexTokens = states.filter(s => v.message.includes(s));
        const toRemove = mutexTokens[1] ?? mutexTokens[0];
        const newStates = states.filter(s => s !== toRemove);
        patches.push({
          type: 'update_field',
          index: idx,
          field: 'state',
          value: newStates,
          reason: `fix state_mutex: remove ${toRemove} from node ${idx}`,
        });
        break;
      }
      case 'no_duplicate_state': {
        // 选 node_index_end 而非 node_index(eng-review C2 注释):
        // 保留前序节点的 state 语义(如 at_hotel 表示出发点),清除后续节点的重复。
        // 两边都可清,选 end 是任意但合理:前序节点的 state 通常是"主动声明",
        // 后续节点重复持有更可能是 bug(忘记 transition)。
        const idx = v.location.node_index_end ?? 1;
        const node = artifact.nodes[idx];
        const states = Array.isArray(node?.state) ? node.state.map(String) : [];
        const match = v.message.match(/"([^"]+)"/);
        const dupToken = match?.[1] ?? states[0];
        const newStates = states.filter(s => s !== dupToken);
        patches.push({
          type: 'update_field',
          index: idx,
          field: 'state',
          value: newStates,
          reason: `fix no_duplicate_state: remove ${dupToken} from node ${idx}`,
        });
        break;
      }
      default:
        break;
    }
  }

  return patches;
}
