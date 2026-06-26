import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, readdirSync, rmSync } from 'node:fs';
import { loadContract } from '../../src/contract/validate.js';
import { buildGateRequest, processGateDecision } from '../../src/agents/human-gate.js';
import type { ContractPatch } from '../../src/contract/patch.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONTRACT_PATH = join(__dirname, '..', '..', 'contracts', 'travel-sequence-v1.yaml');
const REJECTED_DIR = join(__dirname, '..', '..', 'contracts', 'rejected-proposals');

describe('P1 §2.6 Human Gate', () => {
  const contract = loadContract(CONTRACT_PATH);
  const samplePatches: ContractPatch[] = [
    {
      op: 'add_constraint',
      constraint: { id: 'beach_hiking_mutex', type: 'declarative', mutex: ['beach', 'hiking'] },
      reason: 'novel beach state needs mutex',
    },
    { op: 'adjust_weight', dim: 'routing', new_weight: 0.4, reason: 'routing more important' },
  ];

  beforeEach(() => {
    // 清理 rejected-proposals 目录
    if (existsSync(REJECTED_DIR)) {
      for (const f of readdirSync(REJECTED_DIR)) {
        rmSync(join(REJECTED_DIR, f));
      }
    }
  });

  it('buildGateRequest 生成审批请求摘要', () => {
    const req = buildGateRequest(samplePatches);
    expect(req.patch_count).toBe(2);
    expect(req.summary).toContain('beach_hiking_mutex');
    expect(req.summary).toContain('routing');
    expect(req.patches).toEqual(samplePatches);
  });

  it('approve: 应用 patches + 版本号递增', () => {
    const initialVersion = (contract as any).metadata?.version ?? 1;
    const result = processGateDecision(contract, samplePatches, 'approve');
    expect(result.decision).toBe('approve');
    expect(result.version_bumped).toBe(true);
    expect(result.approved_contract).not.toBeNull();
    expect((result.approved_contract as any).metadata.version).toBe(initialVersion + 1);
    // 验证新约束被加入
    expect(result.approved_contract!.hard_constraints.some(c => c.id === 'beach_hiking_mutex')).toBe(true);
  });

  it('reject: 记录拒绝原因到 rejected-proposals/', () => {
    const result = processGateDecision(contract, samplePatches, 'reject', 'beach_hiking_mutex too restrictive');
    expect(result.decision).toBe('reject');
    expect(result.approved_contract).toBeNull();
    expect(result.version_bumped).toBe(false);
    expect(result.reject_reason).toBe('beach_hiking_mutex too restrictive');
    // 验证拒绝记录文件存在
    const files = existsSync(REJECTED_DIR) ? readdirSync(REJECTED_DIR) : [];
    expect(files.length).toBe(1);
    expect(files[0]).toMatch(/^rejected-.*\.json$/);
  });

  it('modify: 返回 null,不应用不记录', () => {
    const result = processGateDecision(contract, samplePatches, 'modify');
    expect(result.decision).toBe('modify');
    expect(result.approved_contract).toBeNull();
    expect(result.version_bumped).toBe(false);
    const files = existsSync(REJECTED_DIR) ? readdirSync(REJECTED_DIR) : [];
    expect(files.length).toBe(0);
  });

  it('approve 空 patches 不报错(版本仍递增)', () => {
    const result = processGateDecision(contract, [], 'approve');
    expect(result.decision).toBe('approve');
    expect(result.version_bumped).toBe(true);
  });

  afterEach(() => {
    if (existsSync(REJECTED_DIR)) {
      for (const f of readdirSync(REJECTED_DIR)) {
        rmSync(join(REJECTED_DIR, f));
      }
    }
  });
});
