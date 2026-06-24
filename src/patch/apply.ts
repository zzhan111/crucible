import type { Artifact } from '../predicates/types.js';
import type { ArtifactPatch } from './types.js';

/**
 * applyPatches: 按顺序应用 patches 到 artifact,返回新 artifact(不改原对象)。
 * insert 在 after_index 之后插入;后续 patch 的 index 基于已 patched 的数组。
 */
export function applyPatches(artifact: Artifact, patches: ArtifactPatch[]): Artifact {
  let nodes = [...artifact.nodes];
  for (const patch of patches) {
    switch (patch.type) {
      case 'insert': {
        nodes = [...nodes.slice(0, patch.after_index + 1), patch.node, ...nodes.slice(patch.after_index + 1)];
        break;
      }
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
  return { ...artifact, nodes };
}
