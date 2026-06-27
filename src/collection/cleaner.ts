import type { Artifact, ArtifactNode } from '../predicates/types.js';

/**
 * 数据清洗(P3 §2.3): 标准化 + 去重 + 空值处理。
 *
 * 生产级采集场景: 多源数据合并后,可能有重复行/字段格式不一致/空值。
 * 清洗器在 Collector 之后、Scorer 之前运行。
 */

export interface CleanOptions {
  /** 去重的 key 字段(节点级,默认按 JSON 整体比较) */
  dedupeKey?: string;
  /** 是否移除完全空节点(所有字段都是空/undefined,默认 true) */
  removeEmpty?: boolean;
  /** 是否标准化字符串字段(trim + 折叠空白,默认 true) */
  normalizeStrings?: boolean;
}

/**
 * cleanArtifact: 清洗 Artifact 节点。
 * - 移除完全空节点
 * - 标准化字符串(trim/折叠空白)
 * - 去重(按 dedupeKey 或 JSON 整体)
 */
export function cleanArtifact(artifact: Artifact, options: CleanOptions = {}): Artifact {
  const dedupeKey = options.dedupeKey;
  const removeEmpty = options.removeEmpty ?? true;
  const normalizeStrings = options.normalizeStrings ?? true;

  let nodes = artifact.nodes.map(n => cleanNode(n, normalizeStrings));

  if (removeEmpty) {
    nodes = nodes.filter(n => !isEmptyNode(n));
  }

  if (dedupeKey) {
    const seen = new Set<string>();
    nodes = nodes.filter(n => {
      const v = n[dedupeKey];
      if (v === undefined || v === null) return true; // 缺 key 字段不去重
      const key = String(v).trim().toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  } else {
    // 整体 JSON 去重
    const seen = new Set<string>();
    nodes = nodes.filter(n => {
      const key = JSON.stringify(n);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  return { ...artifact, nodes };
}

function cleanNode(node: ArtifactNode, normalize: boolean): ArtifactNode {
  if (!normalize) return node;
  const cleaned: ArtifactNode = {};
  for (const [k, v] of Object.entries(node)) {
    if (typeof v === 'string') {
      cleaned[k] = v.trim().replace(/\s+/g, ' ');
    } else {
      cleaned[k] = v;
    }
  }
  return cleaned;
}

function isEmptyNode(node: ArtifactNode): boolean {
  const entries = Object.entries(node);
  if (entries.length === 0) return true;
  return entries.every(([, v]) => {
    if (v === undefined || v === null) return true;
    if (typeof v === 'string' && v.trim() === '') return true;
    if (Array.isArray(v) && v.length === 0) return true;
    return false;
  });
}
