import type { Artifact } from '../predicates/types.js';
import type { ArtifactPatch } from './types.js';

/**
 * applyPatches: 按顺序应用 patches 到 artifact,返回新 artifact(不改原对象)。
 *
 * P1 修复(eng-review A2): insert 会改变数组长度,若 insert 先于其他 patch 执行,
 * 后续 patch 的 index 会指向错误节点(Critic 基于原 artifact 生成所有 patch 索引)。
 * 策略: 先执行非 insert(replace/delete/update_field),再执行 insert。
 * 这样所有 patch 的 index 都对应原 artifact,不会错位。
 */
export function applyPatches(artifact: Artifact, patches: ArtifactPatch[]): Artifact {
  // 分离 insert 和非 insert
  const inserts: ArtifactPatch[] = [];
  const others: ArtifactPatch[] = [];
  for (const p of patches) {
    if (p.type === 'insert') inserts.push(p);
    else others.push(p);
  }

  let nodes = [...artifact.nodes];

  // 第一步: 执行非 insert 操作(不改变数组长度,索引稳定)
  for (const patch of others) {
    switch (patch.type) {
      case 'replace': {
        nodes = nodes.map((n, i) => (i === patch.index ? patch.node : n));
        break;
      }
      case 'delete': {
        nodes = nodes.filter((_, i) => i !== patch.index);
        break;
      }
      case 'update_field': {
        nodes = nodes.map((n, i) => (i === patch.index ? { ...n, [patch.field]: patch.value } : n));
        break;
      }
    }
  }

  // 第二步: 按 after_index 降序执行 insert(降序避免同一轮 insert 之间的索引干扰)
  // 降序确保每次插入都在正确位置:因为插入后面的位置不会影响前面的 after_index
  const sortedInserts = [...inserts].sort((a, b) => (b.after_index ?? 0) - (a.after_index ?? 0));
  for (const patch of sortedInserts) {
    const idx = patch.after_index ?? 0;
    nodes = [...nodes.slice(0, idx + 1), patch.node, ...nodes.slice(idx + 1)];
  }

  return { ...artifact, nodes };
}
