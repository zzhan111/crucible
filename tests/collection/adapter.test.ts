import { describe, it, expect } from 'vitest';
import { createCollector, collectArtifact } from '../../src/collection/collector.js';
import { bigsetAdapter } from '../../src/collection/bigset-adapter.js';
import { travelAdapter } from '../../src/collection/travel-adapter.js';

describe('P2 §2.2 采集层 — BigSet 适配器', () => {
  const sampleBigSetReport = {
    competitors: [
      { competitor_name: 'CompA', feature: 'AI scoring', pricing: '¥299/月', source: 'report.pdf', source_trust: 0.8, last_verified: '2026-06-01' },
      { competitor_name: 'CompB', feature: 'multi-agent', pricing: '免费', source: 'website', source_trust: 0.7, last_verified: '2026-05-15' },
    ],
  };

  it('validate: 合法输入返回 null', () => {
    expect(bigsetAdapter.validate(sampleBigSetReport)).toBeNull();
  });

  it('validate: 缺 competitors 字段返回错误', () => {
    expect(bigsetAdapter.validate({ foo: 'bar' })).toContain('competitors');
  });

  it('validate: 空数组返回错误', () => {
    expect(bigsetAdapter.validate({ competitors: [] })).toContain('empty');
  });

  it('validate: null 返回错误', () => {
    expect(bigsetAdapter.validate(null)).toContain('null');
  });

  it('adapt: 转换为 table family Artifact', () => {
    const artifact = bigsetAdapter.adapt(sampleBigSetReport);
    expect(artifact.family).toBe('table');
    expect(artifact.nodes).toHaveLength(2);
    expect(artifact.nodes[0].competitor_name).toBe('CompA');
    expect(artifact.nodes[1].pricing).toBe('免费');
  });

  it('adapt: 缺失字段用默认值填充', () => {
    const partial = { competitors: [{ competitor_name: 'CompX' }] };
    const artifact = bigsetAdapter.adapt(partial);
    expect(artifact.nodes[0].feature).toBe('');
    expect(artifact.nodes[0].source_trust).toBe(0);
  });
});

describe('P2 §2.2 采集层 — Travel 适配器', () => {
  const sampleGuide = {
    itinerary: [
      { time_block: '08:00-09:00', action: '早餐', duration_min: 60, node_type: 'dining', elasticity: 'compressible', cost: 50, source_trust: 0.8, state: ['at_hotel'] },
      { time_block: '09:00-09:30', action: '步行', duration_min: 30, node_type: 'transit', elasticity: 'non_compressible' },
    ],
  };

  it('validate: 合法输入返回 null', () => {
    expect(travelAdapter.validate(sampleGuide)).toBeNull();
  });

  it('validate: 缺 itinerary 返回错误', () => {
    expect(travelAdapter.validate({ foo: 'bar' })).toContain('itinerary');
  });

  it('adapt: 转换为 sequence family Artifact', () => {
    const artifact = travelAdapter.adapt(sampleGuide);
    expect(artifact.family).toBe('sequence');
    expect(artifact.nodes).toHaveLength(2);
    expect(artifact.nodes[0].action).toBe('早餐');
    expect(artifact.nodes[1].node_type).toBe('transit');
  });

  it('adapt: 缺失字段用默认值', () => {
    const partial = { itinerary: [{ action: 'test' }] };
    const artifact = travelAdapter.adapt(partial);
    expect(artifact.nodes[0].duration_min).toBe(0);
    expect(artifact.nodes[0].node_type).toBe('core_experience');
    expect(artifact.nodes[0].elasticity).toBe('compressible');
    expect(Array.isArray(artifact.nodes[0].state)).toBe(true);
  });
});

describe('P2 §2.2 采集层 — Collector 编排', () => {
  it('createCollector 返回带 source 的 collector', () => {
    const collector = createCollector('bigset');
    expect(collector.source).toBe('bigset');
  });

  it('collect: 合法输入返回 CollectionResult', () => {
    const result = collectArtifact('bigset', {
      competitors: [{ competitor_name: 'A', feature: 'f', pricing: '¥1', source: 's', source_trust: 0.5, last_verified: '2026-01-01' }],
    });
    expect(result.source).toBe('bigset');
    expect(result.artifact.family).toBe('table');
    expect(result.artifact.nodes).toHaveLength(1);
    expect(result.warnings).toEqual([]);
  });

  it('collect: 非法输入返回空 artifact + warning(不 crash)', () => {
    const result = collectArtifact('bigset', null);
    expect(result.artifact.nodes).toEqual([]);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toContain('null');
  });

  it('collectArtifact: travel-guide 源', () => {
    const result = collectArtifact('travel-guide', {
      itinerary: [{ action: 'a', duration_min: 30 }],
    });
    expect(result.source).toBe('travel-guide');
    expect(result.artifact.family).toBe('sequence');
  });
});
