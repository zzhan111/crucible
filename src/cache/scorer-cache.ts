import { createHash } from 'node:crypto';
import type { ScoreReport } from '../scorer/types.js';

/**
 * Scorer 缓存(P3 §2.2): LRU 缓存 ScoreReport。
 *
 * key = hash(JSON.stringify(artifact) + contract_version)
 * 同工件 + 同契约版本 → 命中缓存(不重算)。
 * 契约版本变化(ContractPatch 应用)→ key 不同 → 重新计算。
 */

interface CacheEntry<V> {
  value: V;
  timestamp: number;
  accessedAt: number;
}

export class LRUCache<V> {
  private cache = new Map<string, CacheEntry<V>>();
  private readonly maxSize: number;
  private readonly ttlMs: number;

  constructor(maxSize = 100, ttlMs = 5 * 60 * 1000) {
    this.maxSize = maxSize;
    this.ttlMs = ttlMs;
  }

  get(key: string): V | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;
    // TTL 过期检查
    if (Date.now() - entry.timestamp > this.ttlMs) {
      this.cache.delete(key);
      return undefined;
    }
    // LRU: 更新访问时间(Map 的插入顺序即 LRU 顺序,delete+set 重新插入)
    this.cache.delete(key);
    entry.accessedAt = Date.now();
    this.cache.set(key, entry);
    return entry.value;
  }

  set(key: string, value: V): void {
    // 容量超限时淘汰最旧(Map 第一个元素)
    if (this.cache.size >= this.maxSize && !this.cache.has(key)) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey !== undefined) this.cache.delete(oldestKey);
    }
    this.cache.set(key, { value, timestamp: Date.now(), accessedAt: Date.now() });
  }

  has(key: string): boolean {
    return this.get(key) !== undefined;
  }

  clear(): void {
    this.cache.clear();
  }

  get size(): number {
    return this.cache.size;
  }
}

/** 计算缓存 key: hash(artifact JSON + contract version) */
export function scorerCacheKey(artifact: unknown, contractVersion: number | string = 'v1'): string {
  const artifactJson = JSON.stringify(artifact);
  const input = `${contractVersion}:${artifactJson}`;
  return createHash('sha256').update(input).digest('hex').slice(0, 16);
}

/** 全局 Scorer 缓存实例(单例,进程内共享) */
const globalScorerCache = new LRUCache<ScoreReport>(200, 10 * 60 * 1000); // 10 分钟 TTL

/** 获取全局 Scorer 缓存 */
export function getScorerCache(): LRUCache<ScoreReport> {
  return globalScorerCache;
}
