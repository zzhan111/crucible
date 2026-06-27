import type { Artifact } from '../predicates/types.js';
import type { CollectionResult, CollectionSource, RawArtifact } from './types.js';
import { collectArtifact } from './collector.js';
import { withRetry, type RetryOptions } from './retry.js';
import { TokenBucket, ConcurrencyLimiter, type RateLimitOptions } from './rate-limit.js';
import { cleanArtifact, type CleanOptions } from './cleaner.js';

/**
 * 生产级采集器(P3 §2.3): 在 P2 适配器框架上加 retry / 并发限制 / 速率限制 / 清洗。
 *
 * 用法:
 *   const collector = createProductionCollector('bigset', { retry: {...}, rateLimit: {...} });
 *   const result = await collector.collectMany([raw1, raw2, raw3]);
 */

export interface ProductionCollectorOptions {
  /** 重试选项(默认 3 次指数退避) */
  retry?: RetryOptions;
  /** 速率限制选项(默认 10 容量 / 每秒 5 个) */
  rateLimit?: RateLimitOptions;
  /** 并发限制(默认 3) */
  maxConcurrent?: number;
  /** 清洗选项(默认开启) */
  clean?: CleanOptions | false;
}

export interface ProductionCollectionStats {
  attempts: number;
  totalDelayMs: number;
  rateLimited: boolean;
  cleaned: boolean;
}

export interface ProductionCollectionResult extends CollectionResult {
  stats: ProductionCollectionStats;
}

export interface ProductionCollector {
  source: CollectionSource;
  /** 单条采集(带 retry + rate-limit + clean) */
  collectOne(raw: RawArtifact): Promise<ProductionCollectionResult>;
  /** 批量采集(并发限制 + 速率限制 + 单条 retry) */
  collectMany(raws: RawArtifact[]): Promise<ProductionCollectionResult[]>;
}

export function createProductionCollector(
  source: CollectionSource,
  options: ProductionCollectorOptions = {}
): ProductionCollector {
  const bucket = new TokenBucket(options.rateLimit);
  const limiter = new ConcurrencyLimiter(options.maxConcurrent ?? 3);
  const cleanOpts = options.clean === false ? null : (options.clean ?? {});

  async function collectOne(raw: RawArtifact): Promise<ProductionCollectionResult> {
    // 速率限制(等令牌)
    const rateLimited = !bucket.tryAcquire();
    if (rateLimited) {
      await bucket.acquire(10000); // 等最多 10s
    }

    // 重试包装
    const retryResult = await withRetry(
      async () => collectArtifact(source, raw),
      options.retry
    );

    let collected: CollectionResult;
    if (retryResult.result) {
      collected = retryResult.result;
    } else {
      // 全部失败,返回空 artifact + warning
      collected = {
        artifact: { family: source === 'bigset' ? 'table' : 'sequence', nodes: [] } as Artifact,
        source,
        adapter: 'production-collector',
        warnings: [`retry failed after ${retryResult.attempts} attempts: ${String(retryResult.error)}`],
      };
    }

    // 数据清洗
    let cleaned = false;
    if (cleanOpts !== null && collected.artifact.nodes.length > 0) {
      const dedupeKey = source === 'bigset' ? 'competitor_name' : undefined;
      collected = { ...collected, artifact: cleanArtifact(collected.artifact, { ...cleanOpts, dedupeKey }) };
      cleaned = true;
    }

    return {
      ...collected,
      stats: {
        attempts: retryResult.attempts,
        totalDelayMs: retryResult.totalDelayMs,
        rateLimited,
        cleaned,
      },
    };
  }

  async function collectMany(raws: RawArtifact[]): Promise<ProductionCollectionResult[]> {
    // 并发限制 + 单条 retry + 速率限制(每条独立)
    return Promise.all(raws.map(raw => limiter.run(() => collectOne(raw))));
  }

  return { source, collectOne, collectMany };
}
