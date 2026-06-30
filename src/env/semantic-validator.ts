/**
 * Crucible Live Env — L2 语义校验。
 * spec ref: 2026-06-30-crucible-live-env-design.md §8.1 (Layer 2)
 *
 * zod(L1)只校验"形状对不对",本模块校验"指向的东西存不存在":
 *   - disruption.subject        必须是 artifact.nodes 里某节点的 id
 *   - info_drop.target_field    必须在 contract.fields 里
 *   - info_drop.target_locator  必须是 artifact.nodes 里某节点的 id
 *   - constraint_update.constraint_id 必须在 contract.hard_constraints 里
 *
 * 校验失败:不 throw、返回 { ok: false, reason },由调用方决定丢弃还是降级。
 */
import type { LiveEnvEvent } from './types.js';
import type { Artifact } from '../predicates/types.js';
import type { Contract } from '../contract/schema.js';

export interface ValidationContext {
  artifact: Artifact;
  contract: Contract;
}

export interface ValidationResult {
  ok: boolean;
  reason?: string;
}

/** 在 artifact.nodes 里按 id 找节点。节点无 id 字段时用 index 字符串。 */
function locateNode(artifact: Artifact, locator: string): boolean {
  return artifact.nodes.some((n, i) => {
    const id = (n.id as string | undefined) ?? String(i);
    return id === locator;
  });
}

export function validateSemantics(
  event: LiveEnvEvent,
  ctx: ValidationContext
): ValidationResult {
  switch (event.kind) {
    case 'disruption':
      if (!locateNode(ctx.artifact, event.subject)) {
        return { ok: false, reason: `disruption subject "${event.subject}" not found in artifact nodes` };
      }
      return { ok: true };

    case 'info_drop':
      if (!ctx.contract.fields.some(f => f.name === event.target_field)) {
        return { ok: false, reason: `info_drop target_field "${event.target_field}" not in contract.fields` };
      }
      if (!locateNode(ctx.artifact, event.target_locator)) {
        return { ok: false, reason: `info_drop target_locator "${event.target_locator}" not found in artifact nodes` };
      }
      return { ok: true };

    case 'constraint_update':
      if (!ctx.contract.hard_constraints.some(c => c.id === event.constraint_id)) {
        return { ok: false, reason: `constraint_update constraint_id "${event.constraint_id}" not in contract.hard_constraints` };
      }
      return { ok: true };
  }
}
