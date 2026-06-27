import { describe, it, expect } from 'vitest';
import {
  detectNoveltyV2,
  detectSchemaNovelty,
  detectDistributionOutlier,
  computeFieldStats,
  computeGoldenStats,
  DEFAULT_Z_THRESHOLD,
  isEmbeddingDetectorEnabled,
} from '../../src/curator/novelty_v2.js';
import { GOLDEN_ARTIFACTS } from '../../src/fixtures/golden-set.js';
import type { Artifact } from '../../src/predicates/types.js';

const GOLDEN = GOLDEN_ARTIFACTS.map(g => g.artifact);

describe('P3.5 §2.3 novelty v2', () => {
  describe('computeFieldStats', () => {
    it('从工件集计算均值/标准差', () => {
      const arts: Artifact[] = [
        { family: 'sequence', nodes: [{ cost: 10 }, { cost: 20 }] },
        { family: 'sequence', nodes: [{ cost: 30 }] },
      ];
      const s = computeFieldStats(arts, 'cost');
      expect(s.n).toBe(3);
      expect(s.mean).toBeCloseTo(20, 5);
      expect(s.std).toBeCloseTo(10, 5); // sample std
    });

    it('无数值样本返回 n=0', () => {
      const s = computeFieldStats([{ family: 'sequence', nodes: [{ cost: 'x' }] }], 'cost');
      expect(s.n).toBe(0);
    });

    it('computeGoldenStats 批量计算默认字段', () => {
      const stats = computeGoldenStats(GOLDEN);
      expect(stats.cost.n).toBeGreaterThan(0);
      expect(stats.duration_min.n).toBeGreaterThan(0);
      expect(stats.source_trust.n).toBeGreaterThan(0);
      expect(stats.source_trust.mean).toBeGreaterThan(0);
      expect(stats.source_trust.mean).toBeLessThan(1);
    });
  });

  describe('detectSchemaNovelty', () => {
    it('检出 Contract 未定义的字段', () => {
      const art: Artifact = {
        family: 'sequence',
        nodes: [{ action: 'x', mystery_field: 1, cost: 5 }],
      };
      const p = detectSchemaNovelty(art, ['action', 'cost', 'duration_min', 'node_type', 'state', 'source', 'source_trust', 'route', 'time_block', 'elasticity']);
      expect(p.length).toBeGreaterThanOrEqual(1);
      const tokens = p.flatMap(x => x.tokens);
      expect(tokens).toContain('mystery_field');
    });

    it('内置字段(time_block/action/route)不算 novelty', () => {
      const art: Artifact = {
        family: 'sequence',
        nodes: [{ time_block: '08:00', action: 'x', route: 'a->b' }],
      };
      const p = detectSchemaNovelty(art, []);
      expect(p).toEqual([]);
    });

    it('无 novel 字段返回空', () => {
      const art: Artifact = {
        family: 'sequence',
        nodes: [{ action: 'x', cost: 5 }],
      };
      expect(detectSchemaNovelty(art, ['action', 'cost'])).toEqual([]);
    });
  });

  describe('detectDistributionOutlier', () => {
    it('检出 z-score 超阈值的数值', () => {
      // 黄金集 cost 集中在 0-115;构造一个 cost=9999 的明显异常
      const stats = computeGoldenStats(GOLDEN);
      const art: Artifact = {
        family: 'sequence',
        nodes: [{ cost: 9999, source_trust: 0.5, duration_min: 30 }],
      };
      const p = detectDistributionOutlier(art, stats);
      expect(p.length).toBeGreaterThanOrEqual(1);
      const tokens = p.flatMap(x => x.tokens);
      expect(tokens.some(t => t.startsWith('cost='))).toBe(true);
    });

    it('正常范围内的数值不报', () => {
      const stats = computeGoldenStats(GOLDEN);
      const art: Artifact = {
        family: 'sequence',
        nodes: [{ cost: 30, source_trust: 0.8, duration_min: 60 }],
      };
      // 用默认阈值 2.5,正常值不应触发
      const p = detectDistributionOutlier(art, stats);
      expect(p).toEqual([]);
    });

    it('std=0 的字段跳过(不报假阳)', () => {
      const stats = { x: { mean: 5, std: 0, n: 3 } };
      const art: Artifact = { family: 'sequence', nodes: [{ x: 100 } as never] };
      expect(detectDistributionOutlier(art, stats, DEFAULT_Z_THRESHOLD, ['x'])).toEqual([]);
    });

    it('样本不足(n<2)的字段跳过', () => {
      const stats = { x: { mean: 5, std: 1, n: 1 } };
      const art: Artifact = { family: 'sequence', nodes: [{ x: 100 } as never] };
      expect(detectDistributionOutlier(art, stats, DEFAULT_Z_THRESHOLD, ['x'])).toEqual([]);
    });
  });

  describe('detectNoveltyV2 统一入口', () => {
    it('黄金集工件(无 novel state + 无 novel field + 无 outlier)返回空 proposals', async () => {
      const goldenArt = GOLDEN[0];
      const knownStates = ['at_hotel', 'hiking', 'luggage_drop', 'depart_from_hotel'];
      const knownFields = ['time_block', 'action', 'route', 'duration_min', 'node_type', 'elasticity', 'cost', 'source', 'source_trust', 'state'];
      const stats = computeGoldenStats(GOLDEN);
      const r = await detectNoveltyV2(goldenArt, { knownStates, knownFields, goldenStats: stats });
      expect(r.proposals).toEqual([]);
      expect(r.detectors.state_set).toBe(false);
      expect(r.detectors.schema).toBe(false);
      expect(r.detectors.distribution).toBe(false);
    });

    it('检出 novel state(向后兼容旧行为)', async () => {
      const art: Artifact = {
        family: 'sequence',
        nodes: [{ action: 'x', state: ['totally_new_state'] }],
      };
      const r = await detectNoveltyV2(art, { knownStates: ['at_hotel'] });
      expect(r.detectors.state_set).toBe(true);
      expect(r.proposals[0].tokens).toContain('totally_new_state');
    });

    it('检出 novel node_type(向后兼容旧行为)', async () => {
      const art: Artifact = {
        family: 'sequence',
        nodes: [{ action: 'x', node_type: 'skydiving' }],
      };
      const r = await detectNoveltyV2(art, { knownStates: [], knownNodeTypes: ['dining', 'transit'] });
      expect(r.detectors.node_type_set).toBe(true);
      expect(r.proposals[0].dim).toBe('node_type');
    });

    it('集成:同时触发 schema + distribution + state', async () => {
      const stats = computeGoldenStats(GOLDEN);
      const art: Artifact = {
        family: 'sequence',
        nodes: [{
          action: 'x', state: ['novel_state'], cost: 9999, weird_field: 1,
        }],
      };
      const r = await detectNoveltyV2(art, {
        knownStates: ['at_hotel'],
        knownFields: ['action', 'cost', 'state'],
        goldenStats: stats,
      });
      expect(r.detectors.state_set).toBe(true);
      expect(r.detectors.schema).toBe(true);
      expect(r.detectors.distribution).toBe(true);
      expect(r.proposals.length).toBeGreaterThanOrEqual(3);
    });

    it('不传 goldenStats 时跳过 distribution(不报错)', async () => {
      const art: Artifact = { family: 'sequence', nodes: [{ action: 'x', cost: 99999 }] };
      const r = await detectNoveltyV2(art, { knownStates: [], knownFields: ['action'] });
      expect(r.detectors.distribution).toBe(false);
    });
  });

  describe('embedding detector (skeleton)', () => {
    it('默认 OFF', () => {
      expect(isEmbeddingDetectorEnabled()).toBe(false);
    });
  });
});
