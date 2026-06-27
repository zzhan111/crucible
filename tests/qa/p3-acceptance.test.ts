import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LRUCache, scorerCacheKey, getScorerCache } from '../../src/cache/scorer-cache.js';
import { withRetry } from '../../src/collection/retry.js';
import { TokenBucket, ConcurrencyLimiter } from '../../src/collection/rate-limit.js';
import { cleanArtifact } from '../../src/collection/cleaner.js';
import { createProductionCollector } from '../../src/collection/production-collector.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DSL_DOC = join(__dirname, '..', '..', 'docs', 'dsl-standard', 'crucible-dsl-v1.md');
const MASTRA_DOC = join(__dirname, '..', '..', 'docs', 'decisions', 'mastra-p3-evaluation.md');

/**
 * P3 验收标准 §3.1-3.4 逐项核对。
 */
describe('P3 验收标准核对 (§3.1-3.4)', () => {
  // §3.1 Mastra 评估完成
  describe('§3.1 Mastra 评估完成', () => {
    it('评估报告存在', () => {
      expect(existsSync(MASTRA_DOC)).toBe(true);
    });

    it('报告含版本对比 + 决议', () => {
      const content = readFileSync(MASTRA_DOC, 'utf8');
      expect(content).toContain('1.47.0');
      expect(content).toContain('决议');
      expect(content).toMatch(/保持\s*SimpleAgent|升级 Mastra/);
    });
  });

  // §3.2 缓存层可用
  describe('§3.2 缓存层可用', () => {
    it('LRU 容量限制生效', () => {
      const c = new LRUCache<number>(2, 60000);
      c.set('a', 1); c.set('b', 2); c.set('c', 3);
      expect(c.has('a')).toBe(false); // 淘汰
      expect(c.size).toBe(2);
    });

    it('TTL 过期', async () => {
      const c = new LRUCache<number>(10, 30);
      c.set('x', 1);
      await new Promise(r => setTimeout(r, 50));
      expect(c.get('x')).toBeUndefined();
    });

    it('cache key 同输入相同', () => {
      const a = { nodes: [{ x: 1 }] };
      expect(scorerCacheKey(a, 'v1')).toBe(scorerCacheKey(a, 'v1'));
    });

    it('cache key 不同版本不同', () => {
      const a = { nodes: [] };
      expect(scorerCacheKey(a, 'v1')).not.toBe(scorerCacheKey(a, 'v2'));
    });

    it('全局缓存单例', () => {
      expect(getScorerCache()).toBe(getScorerCache());
    });
  });

  // §3.3 BigSet 采集器生产级
  describe('§3.3 BigSet 采集器生产级', () => {
    it('retry: 失败重试', async () => {
      let n = 0;
      const r = await withRetry(async () => {
        n++;
        if (n < 2) throw new Error('fail');
        return 'ok';
      }, { initialDelayMs: 5 });
      expect(r.result).toBe('ok');
      expect(r.attempts).toBe(2);
    });

    it('rate-limit: 令牌桶生效', () => {
      const b = new TokenBucket({ capacity: 2, refillPerSecond: 0.001 });
      expect(b.tryAcquire()).toBe(true);
      expect(b.tryAcquire()).toBe(true);
      expect(b.tryAcquire()).toBe(false);
    });

    it('concurrency: 并发限制生效', async () => {
      const l = new ConcurrencyLimiter(2);
      let peak = 0, cur = 0;
      const task = async () => {
        cur++; peak = Math.max(peak, cur);
        await new Promise(r => setTimeout(r, 10)); cur--;
      };
      await Promise.all([l.run(task), l.run(task), l.run(task)]);
      expect(peak).toBeLessThanOrEqual(2);
    });

    it('clean: 去重 + 空节点移除', () => {
      const a = { family: 'table' as const, nodes: [
        { competitor_name: 'A' }, { competitor_name: 'A' }, {},
      ]};
      const cleaned = cleanArtifact(a, { dedupeKey: 'competitor_name' });
      expect(cleaned.nodes).toHaveLength(1);
    });

    it('生产级 collector: 集成 retry + rate-limit + clean', async () => {
      const c = createProductionCollector('bigset', {
        retry: { maxAttempts: 1 },
        rateLimit: { capacity: 10, refillPerSecond: 100 },
      });
      const r = await c.collectOne({
        competitors: [{ competitor_name: 'A', feature: 'f', pricing: '¥1', source: 's', source_trust: 0.5, last_verified: '2026-01-01' }],
      });
      expect(r.stats).toBeDefined();
      expect(r.stats.cleaned).toBe(true);
    });
  });

  // §3.4 DSL 草案完成
  describe('§3.4 DSL 草案完成', () => {
    const content = existsSync(DSL_DOC) ? readFileSync(DSL_DOC, 'utf8') : '';

    it('草案文档存在', () => {
      expect(existsSync(DSL_DOC)).toBe(true);
    });

    it('含 8 章节', () => {
      expect(content).toContain('## §1. 概述');
      expect(content).toContain('## §2. Schema 规范');
      expect(content).toContain('## §3. 约束类型');
      expect(content).toContain('## §4. Rubric 模式');
      expect(content).toContain('## §5. 版本治理');
      expect(content).toContain('## §6. 跨族兼容');
      expect(content).toContain('## §7. 校准');
      expect(content).toContain('## §8. 开放性');
    });

    it('Schema 描述与 ContractSchema 一致(fields/hard_constraints/rubric/calibration)', () => {
      expect(content).toContain('artifact_family');
      expect(content).toContain('hard_constraints');
      expect(content).toContain('rubric');
      expect(content).toContain('calibration');
    });

    it('版本治理章节含 ContractPatch + version', () => {
      expect(content).toContain('ContractPatch');
      expect(content).toContain('metadata.version');
    });

    it('校准章节含 Kendall τ + 黄金集', () => {
      expect(content).toContain('Kendall τ');
      expect(content).toContain('黄金集');
      expect(content).toContain('0.5'); // τ 阈值
    });

    it('跨族章节含 artifact_family 枚举', () => {
      expect(content).toContain('sequence');
      expect(content).toContain('table');
    });

    it('约束类型章节含 declarative + code_predicate', () => {
      expect(content).toContain('declarative');
      expect(content).toContain('code_predicate');
      expect(content).toContain('isolated-vm');
    });

    it('rubric 模式章节含 deterministic/judge/proxy+judge', () => {
      expect(content).toContain('deterministic');
      expect(content).toContain('judge');
      expect(content).toContain('proxy+judge');
    });
  });
});
