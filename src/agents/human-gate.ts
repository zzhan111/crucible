import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Contract } from '../contract/schema.js';
import type { ContractPatch } from '../contract/patch.js';
import { applyContractPatch, summarizePatches } from '../contract/patch.js';
import type { Actor } from '../auth/rbac.js';
import { SYSTEM_ACTOR, assertPermission } from '../auth/rbac.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REJECTED_DIR = resolve(__dirname, '..', '..', 'contracts', 'rejected-proposals');

export type GateDecision = 'approve' | 'reject' | 'modify';

export interface GateRequest {
  /** patches 摘要(人类可读) */
  summary: string;
  /** patch 数量 */
  patch_count: number;
  /** 完整 patches(供审批后应用) */
  patches: ContractPatch[];
}

export interface GateResult {
  decision: GateDecision;
  /** 批准:新 Contract;拒绝/修改:null */
  approved_contract: Contract | null;
  /** 版本是否递增 */
  version_bumped: boolean;
  /** 拒绝原因(若 reject) */
  reject_reason?: string;
  /** P4.2: 审批者标识(RBAC 审计 — 谁批的) */
  approver_id: string;
  approver_role: string;
}

/**
 * buildGateRequest: 把 ContractPatch[] 包装成 Human Gate 审批请求。
 * 展示层(AskUserQuestion)调用此函数拿到摘要,再展示给用户。
 */
export function buildGateRequest(patches: ContractPatch[]): GateRequest {
  return {
    summary: summarizePatches(patches),
    patch_count: patches.length,
    patches,
  };
}

/**
 * processGateDecision: 处理 Human Gate 审批决定(P1 §2.6)。
 *
 * - approve: applyContractPatch + bumpVersion → 返回新 Contract
 *   **P4.2 RBAC**: approve 需 'approve:contract' 权限,非 approver/admin 角色抛 PermissionDeniedError
 * - reject:  记录拒绝原因 + 审批者到 contracts/rejected-proposals/ → 返回 null
 * - modify:  返回 null(修改需要重新生成,调用方处理)
 *
 * @param contract 当前 Contract
 * @param patches 待审批 patches
 * @param decision 用户决定
 * @param rejectReason 拒绝原因(若 reject)— 保持原位置,向后兼容
 * @param approver P4.2 审批者 Actor(默认 SYSTEM_ACTOR,向后兼容)
 * @returns GateResult
 */
export function processGateDecision(
  contract: Contract,
  patches: ContractPatch[],
  decision: GateDecision,
  rejectReason?: string,
  approver: Actor = SYSTEM_ACTOR
): GateResult {
  // P4.2 RBAC: 任何审批动作(approve/reject/modify)都需 approve:contract 权限 —
  // 契约变更必须有权的人审。无权抛 PermissionDeniedError。
  assertPermission(approver, 'approve:contract');

  switch (decision) {
    case 'approve': {
      const { contract: newContract, version_bumped } = applyContractPatch(contract, patches, true);
      console.log(`[Human-Gate] approved by ${approver.id}(${approver.role}): ${patches.length} patches, version bumped=${version_bumped}`);
      return { decision: 'approve', approved_contract: newContract, version_bumped, approver_id: approver.id, approver_role: approver.role };
    }
    case 'reject': {
      // 记录拒绝的提议 + 审批者(P4.2 审计:谁拒的、为何拒)
      if (!existsSync(REJECTED_DIR)) mkdirSync(REJECTED_DIR, { recursive: true });
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const rejectPath = join(REJECTED_DIR, `rejected-${timestamp}.json`);
      const payload = {
        rejected_at: new Date().toISOString(),
        approver_id: approver.id,
        approver_role: approver.role,
        reason: rejectReason ?? 'no reason given',
        patches: patches.map(p => ({ ...p })),
        summary: summarizePatches(patches),
      };
      writeFileSync(rejectPath, JSON.stringify(payload, null, 2), 'utf8');
      console.log(`[Human-Gate] rejected by ${approver.id}(${approver.role}): saved to ${rejectPath}`);
      return { decision: 'reject', approved_contract: null, version_bumped: false, reject_reason: rejectReason, approver_id: approver.id, approver_role: approver.role };
    }
    case 'modify': {
      console.log(`[Human-Gate] modify requested by ${approver.id}(${approver.role}): caller should regenerate patches`);
      return { decision: 'modify', approved_contract: null, version_bumped: false, approver_id: approver.id, approver_role: approver.role };
    }
  }
}
