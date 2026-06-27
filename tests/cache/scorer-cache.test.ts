import { describe, it, expect, beforeEach } from 'vitest';
import { LRUCache, scorerCacheKey, getScorerCache } from '../../src/cache/scorer-cache.js';

describe('P3 §2.2 缓存层', () => {
  describe('LRUCache', () => {
    let cache: LRUCache<number>;

    beforeEach(() => {
      cache = new LRUCache<number>(3, 60 * 1000); // 3 条容量,1 分钟 TTL
    });

    it('set + get 基本存取', () => {
      cache.set('a', 1);
      expect(cache.get('a')).toBe(1);
      expect(cache.size).toBe(1);
    });

    it('未命中的 key 返回 undefined', () => {
      expect(cache.get('nonexistent')).toBeUndefined();
    });

    it('has 检查存在性', () => {
      cache.set('a', 1);
      expect(cache.has('a')).toBe(true);
      expect(cache.has('b')).toBe(false);
    });

    it('LRU 淘汰: 超容量时淘汰最旧', () => {
      cache.set('a', 1);
      cache.set('b', 2);
      cache.set('c', 3);
      cache.set('d', 4); // 容量 3,淘汰 'a'(最旧)
      expect(cache.has('a')).toBe(false);
      expect(cache.has('b')).toBe(true);
      expect(cache.has('c')).toBe(true);
      expect(cache.has('d')).toBe(true);
    });

    it('LRU 访问更新顺序: get 后不被淘汰', () => {
      cache.set('a', 1);
      cache.set('b', 2);
      cache.set('c', 3);
      cache.get('a'); // 访问 'a',它变成最新
      cache.set('d', 4); // 淘汰 'b'(现在最旧)
      expect(cache.has('a')).toBe(true); // 'a' 被访问过,保留
      expect(cache.has('b')).toBe(false); // 'b' 被淘汰
    });

    it('TTL 过期: 超时后返回 undefined', async () => {
      const shortCache = new LRUCache<number>(10, 50); // 50ms TTL
      shortCache.set('x', 99);
      expect(shortCache.get('x')).toBe(99);
      await new Promise(r => setTimeout(r, 60));
      expect(shortCache.get('x')).toBeUndefined();
    });

    it('clear 清空所有', () => {
      cache.set('a', 1);
      cache.set('b', 2);
      cache.clear();
      expect(cache.size).toBe(0);
      expect(cache.has('a')).toBe(false);
    });

    it('覆盖已存在的 key(不增加 size)', () => {
      cache.set('a', 1);
      cache.set('a', 2);
      expect(cache.size).toBe(1);
      expect(cache.get('a')).toBe(2);
    });
  });

  describe('scorerCacheKey', () => {
    it('相同 artifact + version → 相同 key', () => {
      const artifact = { family: 'sequence', nodes: [{ action: 'a' }] };
      expect(scorerCacheKey(artifact, 'v1')).toBe(scorerCacheKey(artifact, 'v1'));
    });

    it('不同 version → 不同 key', () => {
      const artifact = { family: 'sequence', nodes: [] };
      expect(scorerCacheKey(artifact, 'v1')).not.toBe(scorerCacheKey(artifact, 'v2'));
    });

    it('不同 artifact → 不同 key', () => {
      const a1 = { family: 'sequence', nodes: [{ action: 'a' }] };
      const a2 = { family: 'sequence', nodes: [{ action: 'b' }] };
      expect(scorerCacheKey(a1, 'v1')).not.toBe(scorerCacheKey(a2, 'v1'));
    });

    it('key 是 16 字符 hex', () => {
      const key = scorerCacheKey({ nodes: [] }, 'v1');
      expect(key).toMatch(/^[a-f0-9]{16}$/);
    });
  });

  describe('全局 Scorer 缓存集成', () => {
    it('getScorerCache 返回单例', () => {
      const c1 = getScorerCache();
      const c2 = getScorerCache();
      expect(c1).toBe(c2);
    });

    it('缓存命中: 同工件第二次 get 命中', () => {
      const cache = getScorerCache();
      cache.clear();
      const artifact = { family: 'sequence', nodes: [{ action: 'test-cache' }] };
      const key = scorerCacheKey(artifact, 'v1');
      const mockReport = { final_score: 0.95 } as any;
      cache.set(key, mockReport);
      expect(cache.get(key)).toEqual(mockReport);
    });
  });
});
