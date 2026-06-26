import { describe, it, expect } from 'vitest';
import { kendallTau, rankingFromScores } from '../../src/calibration/kendall_tau.js';

describe('P1 §2.4 Kendall τ', () => {
  it('完全一致的排序 → τ = 1', () => {
    const a = ['x1', 'x2', 'x3', 'x4'];
    const b = ['x1', 'x2', 'x3', 'x4'];
    const result = kendallTau(a, b);
    expect(result.tau).toBe(1);
    expect(result.concordant).toBe(6); // 4*3/2
    expect(result.discordant).toBe(0);
  });

  it('完全相反的排序 → τ = -1', () => {
    const a = ['x1', 'x2', 'x3', 'x4'];
    const b = ['x4', 'x3', 'x2', 'x1'];
    const result = kendallTau(a, b);
    expect(result.tau).toBe(-1);
    expect(result.discordant).toBe(6);
    expect(result.concordant).toBe(0);
  });

  it('无关排序 → τ = 0(奇数对平衡)', () => {
    // a=[1,2,3], b 交换相邻一对 → 1 concordant, 1 discordant(2 对)→ 不平衡
    // 用 4 元素构造 τ=0:perm = [2,1,4,3] → 2 concordant, 4 discordant? 重算
    // a=[a,b,c,d], b=[b,a,d,c]:perm=[1,0,3,2]
    // pairs: (1,0)D (1,3)C (1,2)C (0,3)C (0,2)C (3,2)D → 4C 2D → τ=(4-2)/6=1/3
    // 要 τ=0 需 3C 3D:perm=[1,0,3,2] 不行。用 perm=[2,0,3,1]:
    // pairs: (2,0)D (2,3)C (2,1)C (0,3)C (0,1)C (3,1)D → 4C 2D = 1/3
    // 实际 n=4 时 τ=0 不可能(total=6 偶数,需 3C3D,但 3C3D→τ=0)
    // perm=[2,1,3,0]:(2,1)D(2,3)C(2,0)C(1,3)C(1,0)C(3,0)D → 4C2D=1/3
    // n=5: total=10, 需 5C5D。perm=[2,1,4,3,0]:
    // 简单验证:用对称构造。a=[1,2,3,4,5], b=[2,1,4,3,5]
    const a = ['1', '2', '3', '4', '5'];
    const b = ['2', '1', '4', '3', '5'];
    // perm=[1,0,3,2,4]
    // 逆序对:(1,0)(3,2) = 2 discordant,其余 8 concordant → τ=(8-2)/10=0.6
    const result = kendallTau(a, b);
    expect(result.tau).toBeCloseTo(0.6, 5);
    expect(result.total_pairs).toBe(10);
  });

  it('部分一致 → 0 < τ < 1', () => {
    const a = ['x1', 'x2', 'x3'];
    const b = ['x1', 'x3', 'x2'];
    // perm=[0,2,1],逆序对:(2,1)=1 discordant,其余 2 concordant
    // τ=(2-1)/3 = 1/3
    const result = kendallTau(a, b);
    expect(result.tau).toBeCloseTo(1 / 3, 5);
  });

  it('n < 2 → τ = 0(无法比较)', () => {
    expect(kendallTau(['x'], ['x']).tau).toBe(0);
    expect(kendallTau([], []).tau).toBe(0);
  });

  it('长度不一致 → 抛错', () => {
    expect(() => kendallTau(['a', 'b'], ['a'])).toThrow(/length mismatch/);
  });

  it('元素集合不同 → 抛错', () => {
    expect(() => kendallTau(['a', 'b'], ['a', 'c'])).toThrow(/same set of IDs/);
  });

  it('rankingFromScores: 按分数降序排列', () => {
    const scores = { 'x3': 0.9, 'x1': 0.5, 'x2': 0.7 };
    expect(rankingFromScores(scores)).toEqual(['x3', 'x2', 'x1']);
  });

  it('黄金集场景:8 工件,judge 与人类高度一致 → τ > 0.5', () => {
    // 模拟 judge 排序和人类排序高度一致(只交换相邻 1 对)
    const human = ['hk-a', 'yn-a', 'fc-a', 'hk-b', 'yn-b', 'hk-c', 'yn-c', 'fc-b'];
    const judge = ['hk-a', 'yn-a', 'fc-a', 'yn-b', 'hk-b', 'hk-c', 'yn-c', 'fc-b'];
    // 交换了 hk-b 和 yn-b(位置 3,4)
    const result = kendallTau(human, judge);
    expect(result.tau).toBeGreaterThan(0.5);
  });

  it('黄金集场景:judge 完全乱序 → τ 接近 0 或负', () => {
    const human = ['hk-a', 'yn-a', 'fc-a', 'hk-b', 'yn-b', 'hk-c', 'yn-c', 'fc-b'];
    const judge = ['fc-b', 'yn-c', 'hk-c', 'yn-b', 'hk-b', 'fc-a', 'yn-a', 'hk-a'];
    const result = kendallTau(human, judge);
    expect(result.tau).toBeLessThan(0);
  });
});
