import type { Artifact } from '../predicates/types.js';
import type { ArtifactAdapter, CollectionSource, RawArtifact } from './types.js';

/**
 * 旅游攻略适配器(P2 §2.2): 旅游攻略文本 → sequence Artifact。
 *
 * 攻略文本格式(预期): JSON 对象,含 itinerary 数组,每段:
 *   { time_block, action, route?, duration_min, node_type, elasticity, cost?, source?, source_trust?, state? }
 *
 * 转换为 family='sequence' 的 Artifact,每段 = 一个节点。
 * 字段缺失用默认值填充(不 crash,让 Scorer 抓违规)。
 */
const DEFAULT_NODE_TYPE = 'core_experience';
const DEFAULT_ELASTICITY = 'compressible';

export const travelAdapter: ArtifactAdapter = {
  source: 'travel-guide' as CollectionSource,
  name: 'travel-guide-adapter',

  validate(raw: RawArtifact): string | null {
    if (raw === null || raw === undefined) return 'input is null/undefined';
    if (typeof raw !== 'object') return `expected object, got ${typeof raw}`;
    const obj = raw as Record<string, unknown>;
    if (!Array.isArray(obj.itinerary)) return 'missing or non-array "itinerary" field';
    if (obj.itinerary.length === 0) return 'itinerary array is empty';
    return null;
  },

  adapt(raw: RawArtifact): Artifact {
    const obj = raw as {
      itinerary: Array<Record<string, unknown>>;
      metadata?: { day?: number; daily_available_minutes?: number; budget?: { min: number; max: number } };
    };
    const nodes = obj.itinerary.map(seg => ({
      time_block: String(seg.time_block ?? ''),
      action: String(seg.action ?? ''),
      route: seg.route !== undefined ? String(seg.route) : undefined,
      duration_min: typeof seg.duration_min === 'number' ? seg.duration_min : 0,
      node_type: String(seg.node_type ?? DEFAULT_NODE_TYPE),
      elasticity: String(seg.elasticity ?? DEFAULT_ELASTICITY),
      cost: typeof seg.cost === 'number' ? seg.cost : undefined,
      source: seg.source !== undefined ? String(seg.source) : undefined,
      source_trust: typeof seg.source_trust === 'number' ? seg.source_trust : 0,
      state: Array.isArray(seg.state) ? seg.state.map(String) : [],
    }));
    return {
      family: 'sequence',
      metadata: obj.metadata ?? { day: 1, daily_available_minutes: 960, budget: { min: 0, max: 800 } },
      nodes,
    };
  },
};
