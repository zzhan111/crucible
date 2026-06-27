import type { Artifact } from '../predicates/types.js';
import type { ArtifactAdapter, CollectionSource, RawArtifact } from './types.js';

/**
 * BigSet 适配器(P2 §2.2): BigSet 深度调研报告 → intel-table Artifact。
 *
 * BigSet 报告格式(预期): JSON 对象,含 competitors 数组,每行:
 *   { competitor_name, feature, pricing, source, source_trust, last_verified }
 *
 * 转换为 family='table' 的 Artifact,每行 = 一个节点。
 * 复用 P1 intel-table fixture 的字段结构。
 */
export const bigsetAdapter: ArtifactAdapter = {
  source: 'bigset' as CollectionSource,
  name: 'bigset-report-adapter',

  validate(raw: RawArtifact): string | null {
    if (raw === null || raw === undefined) return 'input is null/undefined';
    if (typeof raw !== 'object') return `expected object, got ${typeof raw}`;
    const obj = raw as Record<string, unknown>;
    if (!Array.isArray(obj.competitors)) return 'missing or non-array "competitors" field';
    if (obj.competitors.length === 0) return 'competitors array is empty';
    return null;
  },

  adapt(raw: RawArtifact): Artifact {
    const obj = raw as { competitors: Array<Record<string, unknown>> };
    const nodes = obj.competitors.map(row => ({
      competitor_name: String(row.competitor_name ?? ''),
      feature: String(row.feature ?? ''),
      pricing: String(row.pricing ?? ''),
      source: row.source !== undefined ? String(row.source) : undefined,
      source_trust: typeof row.source_trust === 'number' ? row.source_trust : 0,
      last_verified: row.last_verified !== undefined ? String(row.last_verified) : undefined,
    }));
    return {
      family: 'table',
      metadata: { day: 1 },
      nodes,
    };
  },
};
