/**
 * 重试工具(P3 §2.3): 指数退避 + 最大尝试次数。
 *
 * 用于生产级采集层: 网络请求失败时自动重试。
 * 退避: 100ms → 200ms → 400ms ...(每次翻倍)
 */

export interface RetryOptions {
  /** 最大尝试次数(包括首次,默认 3) */
  maxAttempts?: number;
  /** 初始延迟 ms(默认 100) */
  initialDelayMs?: number;
  /** 退避倍数(默认 2,即指数退避) */
  backoffMultiplier?: number;
  /** 最大延迟 ms(默认 5000,避免单次等待过久) */
  maxDelayMs?: number;
  /** 重试判定: 收到错误时返回 true 才重试(默认所有错误都重试) */
  shouldRetry?: (error: unknown, attempt: number) => boolean;
}

export interface RetryResult<T> {
  result?: T;
  error?: unknown;
  attempts: number;
  totalDelayMs: number;
}

/**
 * withRetry: 执行 fn,失败时按指数退避重试。
 * 全部失败返回最后一个错误(不抛,调用方判断)。
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<RetryResult<T>> {
  const maxAttempts = options.maxAttempts ?? 3;
  const initialDelayMs = options.initialDelayMs ?? 100;
  const backoffMultiplier = options.backoffMultiplier ?? 2;
  const maxDelayMs = options.maxDelayMs ?? 5000;
  const shouldRetry = options.shouldRetry ?? (() => true);

  let totalDelayMs = 0;
  let lastError: unknown;
  let actualAttempts = 0;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    actualAttempts = attempt;
    try {
      const result = await fn();
      return { result, attempts: attempt, totalDelayMs };
    } catch (e) {
      lastError = e;
      // 最后一次不退避,直接返回
      if (attempt === maxAttempts) break;
      if (!shouldRetry(e, attempt)) break;
      const delay = Math.min(initialDelayMs * Math.pow(backoffMultiplier, attempt - 1), maxDelayMs);
      totalDelayMs += delay;
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  return { error: lastError, attempts: actualAttempts, totalDelayMs };
}
