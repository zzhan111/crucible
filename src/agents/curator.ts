import type { Artifact } from '../predicates/types.js';

export interface ExpansionProposal {
  dim: 'state' | 'node_type';
  tokens: string[];
  rationale: string;
  proposed_constraint?: string;
}

/**
 * Curator: 检测 artifact 中的新颖 state token / node_type,
 * 提议 Contract 扩张(P0 只检测不合并)。
 * knownStates: Contract 已知的 state tokens。
 * knownNodeTypes: Contract 已知的 node_type enum values(可选)。
 */
export async function detectNovelty(
  artifact: Artifact,
  knownStates: string[],
  knownNodeTypes?: string[]
): Promise<ExpansionProposal[]> {
  const proposals: ExpansionProposal[] = [];

  // 检测新颖 state tokens
  const observedStates = new Set<string>();
  for (const node of artifact.nodes) {
    if (Array.isArray(node.state)) {
      for (const s of node.state) observedStates.add(String(s));
    }
  }
  const novelStates = [...observedStates].filter(s => !knownStates.includes(s));
  if (novelStates.length > 0) {
    proposals.push({
      dim: 'state',
      tokens: novelStates,
      rationale: `artifact contains state tokens not in Contract's known set: ${novelStates.join(', ')}. Consider adding hard constraints or rubric dimensions for these.`,
      proposed_constraint: ` Consider adding mutex/dependency rules involving: ${novelStates.join(', ')}`,
    });
  }

  // 检测新颖 node_type
  if (knownNodeTypes) {
    const observedTypes = new Set<string>();
    for (const node of artifact.nodes) {
      if (node.node_type) observedTypes.add(String(node.node_type));
    }
    const novelTypes = [...observedTypes].filter(t => !knownNodeTypes.includes(t));
    if (novelTypes.length > 0) {
      proposals.push({
        dim: 'node_type',
        tokens: novelTypes,
        rationale: `artifact contains node_type values not in Contract's enum: ${novelTypes.join(', ')}. Consider extending the node_type enum or adding type-specific constraints.`,
      });
    }
  }

  return proposals;
}
