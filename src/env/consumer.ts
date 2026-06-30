/**
 * Crucible Live Env — 事件折叠器(纯函数)。
 * spec ref: 2026-06-30-crucible-live-env-design.md §5.2
 *
 * 把一批事件折叠进 artifact,返回新 artifact + 被应用的事件 id 列表。
 * 三类事件的折叠语义:
 *   - disruption:        per-node state += invalidates;blocker → elasticity=replaceable
 *   - info_drop:         per-node [target_field]=new_value, source=evidence, source_trust=...
 *   - constraint_update: metadata.runtime_overrides[constraint_id]=new_threshold(不动 contract)
 *
 * 不可应用的事件(subject/locator/constraint_id 不存在)→ 跳过,不报错。
 * 纯函数:不 mutate 输入 artifact(深拷贝后改)。
 */
import type { LiveEnvEvent } from './types.js';
import type { Artifact, ArtifactNode } from '../predicates/types.js';
import type { Contract } from '../contract/schema.js';
import { validateSemantics } from './semantic-validator.js';

export interface ConsumeResult {
  artifact: Artifact;
  appliedEventIds: string[];
}

export function consumeEvents(
  artifact: Artifact,
  events: LiveEnvEvent[],
  contract: Contract
): ConsumeResult {
  // 深拷贝,不 mutate 输入
  let next: Artifact = JSON.parse(JSON.stringify(artifact));
  if (!next.metadata) next.metadata = {};
  const applied: string[] = [];

  for (const e of events) {
    // L2 语义校验(复用 semantic-validator)
    const valid = validateSemantics(e, { artifact: next, contract });
    if (!valid.ok) continue; // 跳过,不报错

    const appliedOne = applyOne(next, e);
    if (appliedOne) {
      applied.push(e.id);
    }
  }

  return { artifact: next, appliedEventIds: applied };
}

function findNode(artifact: Artifact, locator: string): { node: ArtifactNode; index: number } | null {
  for (let i = 0; i < artifact.nodes.length; i++) {
    const n = artifact.nodes[i];
    const id = (n.id as string | undefined) ?? String(i);
    if (id === locator) return { node: n, index: i };
  }
  return null;
}

function applyOne(artifact: Artifact, e: LiveEnvEvent): boolean {
  switch (e.kind) {
    case 'disruption': {
      const found = findNode(artifact, e.subject);
      if (!found) return false;
      // per-node state += invalidates
      const state = (found.node.state as string[] | undefined) ?? [];
      for (const tok of e.invalidates) {
        if (!state.includes(tok)) state.push(tok);
      }
      found.node.state = state;
      // blocker → elasticity 强制 replaceable(让 Scorer 下一步显式抓违规)
      if (e.severity === 'blocker') {
        found.node.elasticity = 'replaceable';
      }
      return true;
    }
    case 'info_drop': {
      const found = findNode(artifact, e.target_locator);
      if (!found) return false;
      found.node[e.target_field] = e.new_value;
      found.node.source = e.evidence;
      found.node.source_trust = e.source_trust;
      return true;
    }
    case 'constraint_update': {
      if (!artifact.metadata) artifact.metadata = {};
      if (!artifact.metadata.runtime_overrides) {
        artifact.metadata.runtime_overrides = {};
      }
      artifact.metadata.runtime_overrides[e.constraint_id] = e.new_threshold;
      return true;
    }
  }
}
