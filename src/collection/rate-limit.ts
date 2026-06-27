/**
 * 速率限制(P3 §2.3): 令牌桶算法。
 *
 * 用于生产级采集层: 限制每秒请求数(避免被目标服务限流封禁)。
 * 令牌桶: 容量 N,每秒生成 R 个令牌,请求消耗 1 个令牌。
 */

export interface RateLimitOptions {
  /** 桶容量(最大令牌数,默认 10) */
  capacity?: number;
  /** 每秒填充令牌数(默认 5,即每秒最多 5 个请求) */
  refillPerSecond?: number;
}

export class TokenBucket {
  private tokens: number;
  private readonly capacity: number;
  private readonly refillPerSecond: number;
  private lastRefillTs: number;

  constructor(options: RateLimitOptions = {}) {
    this.capacity = options.capacity ?? 10;
    this.refillPerSecond = options.refillPerSecond ?? 5;
    this.tokens = this.capacity;
    this.lastRefillTs = Date.now();
  }

  /** 按时间流逝填充令牌 */
  private refill(): void {
    const now = Date.now();
    const elapsedSec = (now - this.lastRefillTs) / 1000;
    const newTokens = elapsedSec * this.refillPerSecond;
    this.tokens = Math.min(this.capacity, this.tokens + newTokens);
    this.lastRefillTs = now;
  }

  /**
   * 尝试消耗一个令牌。
   * @returns true 成功(可立即请求), false 桶空(需等待)
   */
  tryAcquire(): boolean {
    this.refill();
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }
    return false;
  }

  /**
   * 等待并消耗一个令牌(异步阻塞至有令牌可用)。
   * @param timeoutMs 最大等待时间,超时返回 false
   */
  async acquire(timeoutMs = 30000): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (this.tryAcquire()) return true;
      // 等待下一个令牌生成所需时间
      const waitMs = Math.min(1000 / this.refillPerSecond, 100);
      await new Promise(resolve => setTimeout(resolve, waitMs));
    }
    return false;
  }

  /** 当前可用令牌数(调试用) */
  get available(): number {
    this.refill();
    return this.tokens;
  }
}

/**
 * 并发限制器: 限制同时执行的 Promise 数量。
 * 用于 Promise.all 大量请求时控制并发(避免压垮服务/本地资源)。
 */
export class ConcurrencyLimiter {
  private active = 0;
  private queue: Array<() => void> = [];
  private readonly maxConcurrent: number;

  constructor(maxConcurrent = 3) {
    this.maxConcurrent = maxConcurrent;
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.maxConcurrent) {
      await new Promise<void>(resolve => this.queue.push(resolve));
    }
    this.active++;
    try {
      return await fn();
    } finally {
      this.active--;
      const next = this.queue.shift();
      if (next) next();
    }
  }

  get activeCount(): number {
    return this.active;
  }
}
