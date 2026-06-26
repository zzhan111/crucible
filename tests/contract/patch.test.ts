import { describe, it, expect } from 'vitest';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadContract } from '../../src/contract/validate.js';
import { compileContract } from '../../src/contract/compiler.js';
import { applyContractPatch, summarizePatches } from '../../src/contract/patch.js';
import { contractAuthorRevise } from '../../src/agents/contract-author.js';
import type { ContractPatch } from '../../src/contract/patch.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONTRACT_PATH = join(__dirname, '..', '..', 'contracts', 'travel-sequence-v1.yaml');

describe('P1 §2.5 ContractPatch + applyContractPatch', () => {
  const contract = loadContract(CONTRACT_PATH);

  it('applyContractPatch: add_constraint 增加硬约束', () => {
    const patches: ContractPatch[] = [
      {
        op: 'add_constraint',
        constraint: { id: 'test_mutex', type: 'declarative', mutex: ['beach', 'hiking'] },
        reason: 'novel state beach needs mutex with hiking',
      },
    ];
    const { contract: newContract } = applyContractPatch(contract, patches, false);
    expect(newContract.hard_constraints.some(c => c.id === 'test_mutex')).toBe(true);
    // 原约束保留
    expect(newContract.hard_constraints.length).toBe(contract.hard_constraints.length + 1);
  });

  it('applyContractPatch: add_constraint 幂等(同 id 不重复加)', () => {
    const patches: ContractPatch[] = [
      {
        op: 'add_constraint',
        constraint: { id: 'test_mutex', type: 'declarative', mutex: ['a', 'b'] },
        reason: 'x',
      },
      {
        op: 'add_constraint',
        constraint: { id: 'test_mutex', type: 'declarative', mutex: ['a', 'b'] },
        reason: 'x again',
      },
    ];
    const { contract: newContract } = applyContractPatch(contract, patches, false);
    const count = newContract.hard_constraints.filter(c => c.id === 'test_mutex').length;
    expect(count).toBe(1);
  });

  it('applyContractPatch: remove_constraint 删约束', () => {
    const firstId = contract.hard_constraints[0].id;
    const patches: ContractPatch[] = [
      { op: 'remove_constraint', constraint_id: firstId, reason: 'test remove' },
    ];
    const { contract: newContract } = applyContractPatch(contract, patches, false);
    expect(newContract.hard_constraints.some(c => c.id === firstId)).toBe(false);
    expect(newContract.hard_constraints.length).toBe(contract.hard_constraints.length - 1);
  });

  it('applyContractPatch: adjust_weight 调权重 + 归一化(sum=1.0)', () => {
    const patches: ContractPatch[] = [
      { op: 'adjust_weight', dim: 'routing', new_weight: 0.5, reason: 'test' },
    ];
    const { contract: newContract } = applyContractPatch(contract, patches, false);
    const sum = newContract.rubric.reduce((acc, r) => acc + r.weight, 0);
    expect(Math.abs(sum - 1.0)).toBeLessThan(0.001);
    const routing = newContract.rubric.find(r => r.dim === 'routing');
    // 归一化后权重比例保持 0.5/max
    expect(routing).toBeDefined();
  });

  it('applyContractPatch: 版本号递增(bumpVersion=true)', () => {
    const initialVersion = (contract as any).metadata?.version ?? 1;
    const { contract: newContract, version_bumped } = applyContractPatch(
      contract,
      [{ op: 'adjust_weight', dim: 'routing', new_weight: 0.3, reason: 'bump test' }],
      true
    );
    expect(version_bumped).toBe(true);
    expect((newContract as any).metadata.version).toBe(initialVersion + 1);
  });

  it('applyContractPatch: bumpVersion=false 不递增', () => {
    const { version_bumped } = applyContractPatch(contract, [], false);
    expect(version_bumped).toBe(false);
  });

  it('summarizePatches 生成人类可读摘要', () => {
    const patches: ContractPatch[] = [
      {
        op: 'add_constraint',
        constraint: { id: 'beach_hiking_mutex', type: 'declarative', mutex: ['beach', 'hiking'] },
        reason: 'novel beach state',
      },
      { op: 'adjust_weight', dim: 'routing', new_weight: 0.4, reason: 'routing more important' },
    ];
    const summary = summarizePatches(patches);
    expect(summary).toContain('beach_hiking_mutex');
    expect(summary).toContain('routing');
    expect(summary).toContain('0.400');
  });

  it('summarizePatches 空列表返回"无修订"', () => {
    expect(summarizePatches([])).toBe('无修订');
  });
});

describe('P1 §2.5 contractAuthorRevise', () => {
  const contract = loadContract(CONTRACT_PATH);

  it('无提议时返回空 diff', async () => {
    const patches = await contractAuthorRevise(contract, []);
    expect(patches).toEqual([]);
  });

  it('降级模式(无 API key)返回空 diff', async () => {
    // 测试环境无 OPENAI_API_KEY
    const proposals = [
      {
        dim: 'state' as const,
        tokens: ['beach'],
        rationale: 'novel state token beach observed',
        proposed_constraint: 'add mutex for beach',
      },
    ];
    const patches = await contractAuthorRevise(contract, proposals);
    expect(patches).toEqual([]);
  });

  it('有提议 + 无 API key 仍正常返回(不抛错)', async () => {
    const proposals = [
      {
        dim: 'state' as const,
        tokens: ['beach', 'island'],
        rationale: 'novel tokens',
      },
      {
        dim: 'node_type' as const,
        tokens: ['ferry'],
        rationale: 'novel node type',
      },
    ];
    const patches = await contractAuthorRevise(contract, proposals);
    expect(Array.isArray(patches)).toBe(true);
  });
});
