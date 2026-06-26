import { describe, it, expect } from 'vitest';
import { getGoldenArtifacts, loadHumanRanking } from '../../src/calibration/golden_set.js';

describe('P1 §2.3 人类排序文件', () => {
  const golden = getGoldenArtifacts();
  const goldenIds = new Set(golden.map(g => g.id));
  const human = loadHumanRanking();

  it('人类排序文件存在且可加载', () => {
    expect(human).not.toBeNull();
  });

  it('人类排序包含全部 8 个工件 ID', () => {
    expect(human).not.toBeNull();
    const rankingIds = new Set(human!.ranking);
    expect(rankingIds.size).toBe(8);
    for (const id of goldenIds) {
      expect(rankingIds.has(id)).toBe(true);
    }
  });

  it('人类排序无重复 ID', () => {
    expect(human).not.toBeNull();
    expect(new Set(human!.ranking).size).toBe(human!.ranking.length);
  });

  it('人类排序与黄金集 ID 完全匹配(集合相等)', () => {
    expect(human).not.toBeNull();
    expect(new Set(human!.ranking)).toEqual(goldenIds);
  });

  it('人类排序有维度说明', () => {
    expect(human).not.toBeNull();
    expect(human!.dimension).toBeTruthy();
    expect(human!.dimension.length).toBeGreaterThan(5);
  });
});
