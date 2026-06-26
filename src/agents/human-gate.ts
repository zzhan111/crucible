import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Contract } from '../contract/schema.js';
import type { ContractPatch } from '../contract/patch.js';
import { applyContractPatch, summarizePatches } from '../contract/patch.js';

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
 * - reject:  记录拒绝原因到 contracts/rejected-proposals/ → 返回 null
 * - modify:  返回 null(修改需要重新生成,调用方处理)
 *
 * @param contract 当前 Contract
 * @param patches 待审批 patches
 * @param decision 用户决定
 * @param rejectReason 拒绝原因(若 reject)
 * @returns GateResult
 */
export function processGateDecision(
  contract: Contract,
  patches: ContractPatch[],
  decision: GateDecision,
  rejectReason?: string
): GateResult {
  switch (decision) {
    case 'approve': {
      const { contract: newContract, version_bumped } = applyContractPatch(contract, patches, true);
      console.log(`[Human-Gate] approved: ${patches.length} patches, version bumped=${version_bumped}`);
      return { decision: 'approve', approved_contract: newContract, version_bumped };
    }
    case 'reject': {
      // 记录拒绝的提议
      if (!existsSync(REJECTED_DIR)) mkdirSync(REJECTED_DIR, { recursive: true });
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const rejectPath = join(REJECTED_DIR, `rejected-${timestamp}.json`);
      const payload = {
        rejected_at: new Date().toISOString(),
        reason: rejectReason ?? 'no reason given',
        patches: patches.map(p => ({ ...p })),
        summary: summarizePatches(patches),
      };
      writeFileSync(rejectPath, JSON.stringify(payload, null, 2), 'utf8');
      console.log(`[Human-Gate] rejected: saved to ${rejectPath}`);
      return { decision: 'reject', approved_contract: null, version_bumped: false, reject_reason: rejectReason };
    }
    case 'modify': {
      console.log('[Human-Gate] modify requested: caller should regenerate patches');
      return { decision: 'modify', approved_contract: null, version_bumped: false };
    }
  }
}
