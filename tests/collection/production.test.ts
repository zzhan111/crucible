import { describe, it, expect } from 'vitest';
import { withRetry } from '../../src/collection/retry.js';
import { TokenBucket, ConcurrencyLimiter } from '../../src/collection/rate-limit.js';
import { cleanArtifact } from '../../src/collection/cleaner.js';
import { createProductionCollector } from '../../src/collection/production-collector.js';
import type { Artifact } from '../../src/predicates/types.js';

describe('P3 §2.3 重试逻辑', () => {
  it('成功执行: 第一次成功,attempts=1', async () => {
    const r = await withRetry(async () => 42);
    expect(r.result).toBe(42);
    expect(r.attempts).toBe(1);
    expect(r.totalDelayMs).toBe(0);
  });

  it('重试后成功: 第二次成功,attempts=2', async () => {
    let count = 0;
    const r = await withRetry(async () => {
      count++;
      if (count < 2) throw new Error('fail');
      return 'ok';
    }, { initialDelayMs: 10 });
    expect(r.result).toBe('ok');
    expect(r.attempts).toBe(2);
    expect(r.totalDelayMs).toBeGreaterThanOrEqual(10);
  });

  it('全部失败: 返回 error,attempts=maxAttempts', async () => {
    const r = await withRetry(async () => { throw new Error('always fail'); }, { maxAttempts: 3, initialDelayMs: 10 });
    expect(r.result).toBeUndefined();
    expect(r.error).toBeInstanceOf(Error);
    expect(r.attempts).toBe(3);
  });

  it('指数退避: 延迟随尝试翻倍', async () => {
    const r = await withRetry(async () => { throw new Error('fail'); }, {
      maxAttempts: 4, initialDelayMs: 10, backoffMultiplier: 2,
    });
    // 退避: 10ms + 20ms + 40ms = 70ms (前 3 次失败后退避,第 4 次失败不退避)
    expect(r.totalDelayMs).toBeGreaterThanOrEqual(60);
    expect(r.totalDelayMs).toBeLessThan(200);
  });

  it('shouldRetry=false 时停止重试', async () => {
    let count = 0;
    const r = await withRetry(async () => { count++; throw new Error('skip'); }, {
      maxAttempts: 5, initialDelayMs: 5,
      shouldRetry: () => false, // 立即停止
    });
    expect(count).toBe(1);
    expect(r.attempts).toBe(1);
  });
});

describe('P3 §2.3 速率限制 (TokenBucket)', () => {
  it('初始容量: tryAcquire 成功 N 次', () => {
    const bucket = new TokenBucket({ capacity: 3, refillPerSecond: 1 });
    expect(bucket.tryAcquire()).toBe(true);
    expect(bucket.tryAcquire()).toBe(true);
    expect(bucket.tryAcquire()).toBe(true);
    expect(bucket.tryAcquire()).toBe(false); // 桶空
  });

  it('refill: 等待后令牌恢复', async () => {
    const bucket = new TokenBucket({ capacity: 2, refillPerSecond: 100 }); // 快速恢复
    bucket.tryAcquire();
    bucket.tryAcquire();
    expect(bucket.tryAcquire()).toBe(false);
    await new Promise(r => setTimeout(r, 30)); // 30ms = 3 个令牌
    expect(bucket.tryAcquire()).toBe(true);
  });

  it('acquire 异步阻塞至有令牌', async () => {
    const bucket = new TokenBucket({ capacity: 1, refillPerSecond: 50 });
    bucket.tryAcquire(); // 消耗最后一个
    const start = Date.now();
    const got = await bucket.acquire(500);
    expect(got).toBe(true);
    expect(Date.now() - start).toBeGreaterThan(5); // 至少等了点时间
  });

  it('acquire 超时返回 false', async () => {
    const bucket = new TokenBucket({ capacity: 1, refillPerSecond: 0.01 }); // 几乎不恢复
    bucket.tryAcquire();
    const got = await bucket.acquire(50);
    expect(got).toBe(false);
  });
});

describe('P3 §2.3 并发限制 (ConcurrencyLimiter)', () => {
  it('限制同时执行不超过 maxConcurrent', async () => {
    const limiter = new ConcurrencyLimiter(2);
    let peak = 0;
    let current = 0;
    const task = async () => {
      current++;
      peak = Math.max(peak, current);
      await new Promise(r => setTimeout(r, 20));
      current--;
    };
    await Promise.all([
      limiter.run(task), limiter.run(task), limiter.run(task), limiter.run(task),
    ]);
    expect(peak).toBeLessThanOrEqual(2);
  });

  it('全部任务最终完成', async () => {
    const limiter = new ConcurrencyLimiter(2);
    const results = await Promise.all([
      limiter.run(async () => 1),
      limiter.run(async () => 2),
      limiter.run(async () => 3),
    ]);
    expect(results).toEqual([1, 2, 3]);
  });
});

describe('P3 §2.3 数据清洗', () => {
  it('移除完全空节点', () => {
    const a: Artifact = { family: 'sequence', nodes: [
      { action: 'a' }, { action: '' }, { },
    ]};
    const cleaned = cleanArtifact(a);
    expect(cleaned.nodes).toHaveLength(1);
    expect(cleaned.nodes[0].action).toBe('a');
  });

  it('标准化字符串: trim + 折叠空白', () => {
    const a: Artifact = { family: 'sequence', nodes: [
      { action: '  hello   world  ' },
    ]};
    const cleaned = cleanArtifact(a);
    expect(cleaned.nodes[0].action).toBe('hello world');
  });

  it('按 dedupeKey 去重', () => {
    const a: Artifact = { family: 'table', nodes: [
      { competitor_name: 'A', feature: 'f1' },
      { competitor_name: 'A', feature: 'f2' }, // 重复 name → 移除
      { competitor_name: 'B', feature: 'f3' },
    ]};
    const cleaned = cleanArtifact(a, { dedupeKey: 'competitor_name' });
    expect(cleaned.nodes).toHaveLength(2);
    expect(cleaned.nodes.map(n => n.competitor_name)).toEqual(['A', 'B']);
  });

  it('无 dedupeKey 时按 JSON 整体去重', () => {
    const a: Artifact = { family: 'sequence', nodes: [
      { action: 'a', duration_min: 30 },
      { action: 'a', duration_min: 30 }, // 完全一样 → 去重
      { action: 'a', duration_min: 60 }, // 不同 → 保留
    ]};
    const cleaned = cleanArtifact(a);
    expect(cleaned.nodes).toHaveLength(2);
  });

  it('options.removeEmpty=false 保留空节点', () => {
    const a: Artifact = { family: 'sequence', nodes: [{ }, { action: 'a' }] };
    const cleaned = cleanArtifact(a, { removeEmpty: false });
    expect(cleaned.nodes).toHaveLength(2);
  });
});

describe('P3 §2.3 ProductionCollector 集成', () => {
  it('collectOne: 单条采集 + stats', async () => {
    const collector = createProductionCollector('bigset', {
      retry: { maxAttempts: 1 },
      rateLimit: { capacity: 10, refillPerSecond: 100 },
    });
    const result = await collector.collectOne({
      competitors: [{ competitor_name: 'A', feature: 'f', pricing: '¥1', source: 's', source_trust: 0.5, last_verified: '2026-01-01' }],
    });
    expect(result.artifact.family).toBe('table');
    expect(result.artifact.nodes).toHaveLength(1);
    expect(result.stats.attempts).toBe(1);
    expect(result.stats.cleaned).toBe(true);
  });

  it('collectMany: 批量采集 + 并发限制', async () => {
    const collector = createProductionCollector('bigset', {
      maxConcurrent: 2,
      rateLimit: { capacity: 100, refillPerSecond: 1000 },
    });
    const raws = [
      { competitors: [{ competitor_name: 'A', feature: 'f1', pricing: '¥1', source: 's', source_trust: 0.5, last_verified: '2026-01-01' }] },
      { competitors: [{ competitor_name: 'B', feature: 'f2', pricing: '¥2', source: 's', source_trust: 0.5, last_verified: '2026-01-01' }] },
      { competitors: [{ competitor_name: 'C', feature: 'f3', pricing: '¥3', source: 's', source_trust: 0.5, last_verified: '2026-01-01' }] },
    ];
    const results = await collector.collectMany(raws);
    expect(results).toHaveLength(3);
    expect(results.every(r => r.artifact.nodes.length === 1)).toBe(true);
  });

  it('collectOne: bigset 数据自动去重(dedupeKey=competitor_name)', async () => {
    const collector = createProductionCollector('bigset', {
      retry: { maxAttempts: 1 },
      rateLimit: { capacity: 10, refillPerSecond: 100 },
    });
    const result = await collector.collectOne({
      competitors: [
        { competitor_name: 'A', feature: 'f1', pricing: '¥1', source: 's', source_trust: 0.5, last_verified: '2026-01-01' },
        { competitor_name: 'A', feature: 'f2', pricing: '¥2', source: 's', source_trust: 0.5, last_verified: '2026-01-01' }, // 重复
      ],
    });
    expect(result.artifact.nodes).toHaveLength(1); // 去重后只剩 1 个
    expect(result.stats.cleaned).toBe(true);
  });
});
