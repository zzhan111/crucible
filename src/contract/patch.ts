import type { Contract, FieldDef, HardConstraint, RubricEntry } from './schema.js';

/**
 * ContractPatch:契约修订 diff(P1 §2.5)。
 * 作用于 Contract YAML,类似 ArtifactPatch 但面向契约。
 * 最小 diff 格式:加字段/加约束/调权重(spec §6 风险对策)。
 */
export type ContractPatch =
  | { op: 'add_field'; field: FieldDef; reason: string }
  | { op: 'remove_field'; field_name: string; reason: string }
  | { op: 'add_constraint'; constraint: HardConstraint; reason: string }
  | { op: 'remove_constraint'; constraint_id: string; reason: string }
  | { op: 'adjust_weight'; dim: string; new_weight: number; reason: string }
  | { op: 'add_rubric'; rubric: RubricEntry; reason: string }
  | { op: 'remove_rubric'; dim: string; reason: string };

/**
 * applyContractPatch: 应用 ContractPatch 列表到 Contract,返回新 Contract。
 * 版本号通过 metadata.version 管理(若存在)。
 *
 * 重要:应用后 rubric 权重可能不再 sum=1.0,调用方需归一化。
 * @returns { contract: 新 Contract, version_bumped: 版本是否递增 }
 */
export function applyContractPatch(
  contract: Contract,
  patches: ContractPatch[],
  bumpVersion = true
): { contract: Contract; version_bumped: boolean } {
  let fields = [...contract.fields];
  let hardConstraints = [...contract.hard_constraints];
  let rubric = [...contract.rubric];
  let versionBumped = false;

  for (const patch of patches) {
    switch (patch.op) {
      case 'add_field':
        if (!fields.some(f => f.name === patch.field.name)) {
          fields.push(patch.field);
        }
        break;
      case 'remove_field':
        fields = fields.filter(f => f.name !== patch.field_name);
        break;
      case 'add_constraint':
        if (!hardConstraints.some(c => c.id === patch.constraint.id)) {
          hardConstraints.push(patch.constraint);
        }
        break;
      case 'remove_constraint':
        hardConstraints = hardConstraints.filter(c => c.id !== patch.constraint_id);
        break;
      case 'adjust_weight': {
        rubric = rubric.map(r =>
          r.dim === patch.dim ? { ...r, weight: patch.new_weight } : r
        );
        break;
      }
      case 'add_rubric':
        if (!rubric.some(r => r.dim === patch.rubric.dim)) {
          rubric.push(patch.rubric);
        }
        break;
      case 'remove_rubric':
        rubric = rubric.filter(r => r.dim !== patch.dim);
        break;
    }
  }

  // 归一化 rubric 权重(sum=1.0)
  const weightSum = rubric.reduce((acc, r) => acc + r.weight, 0);
  if (weightSum > 0 && Math.abs(weightSum - 1.0) > 0.001) {
    rubric = rubric.map(r => ({ ...r, weight: r.weight / weightSum }));
  }

  // 版本递增:在 metadata.version 上 +1(若存在)
  const meta = (contract as Contract & { metadata?: { version?: number } }).metadata;
  let newMeta = meta;
  if (bumpVersion) {
    const currentVersion = meta?.version ?? 1;
    newMeta = { ...(meta ?? {}), version: currentVersion + 1 };
    versionBumped = true;
  }

  const newContract: Contract = {
    ...contract,
    fields,
    hard_constraints: hardConstraints,
    rubric,
    ...(newMeta ? { metadata: newMeta } : {}),
  } as Contract;

  return { contract: newContract, version_bumped: versionBumped };
}

/**
 * summarizePatches: 生成 patches 的人类可读摘要(供 Human Gate 展示)。
 */
export function summarizePatches(patches: ContractPatch[]): string {
  if (patches.length === 0) return '无修订';
  const lines = patches.map((p, i) => {
    switch (p.op) {
      case 'add_field':
        return `${i + 1}. 加字段: ${p.field.name} (${p.field.type}) — ${p.reason}`;
      case 'remove_field':
        return `${i + 1}. 删字段: ${p.field_name} — ${p.reason}`;
      case 'add_constraint':
        return `${i + 1}. 加约束: ${p.constraint.id} (${p.constraint.type}) — ${p.reason}`;
      case 'remove_constraint':
        return `${i + 1}. 删约束: ${p.constraint_id} — ${p.reason}`;
      case 'adjust_weight':
        return `${i + 1}. 调权重: ${p.dim} → ${p.new_weight.toFixed(3)} — ${p.reason}`;
      case 'add_rubric':
        return `${i + 1}. 加 rubric: ${p.rubric.dim} (w=${p.rubric.weight}, mode=${p.rubric.mode}) — ${p.reason}`;
      case 'remove_rubric':
        return `${i + 1}. 删 rubric: ${p.dim} — ${p.reason}`;
    }
  });
  return lines.join('\n');
}
