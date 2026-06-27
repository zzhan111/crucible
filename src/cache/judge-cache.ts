import type { RubricScore } from '../rubric/types.js';
import { LRUCache } from './scorer-cache.js';

/**
 * Judge 缓存(P3 §2.2): 短期缓存 judge rubric 结果,减少重复 LLM 调用。
 *
 * key = hash(artifact JSON + dim + contract version)
 * TTL 5 分钟(judge 结果短期稳定,超时重新评估)。
 * LRU 50 条(judge 调用昂贵但工件有限)。
 */

export interface JudgeCacheKey {
  artifactJson: string;
  dim: string;
  contractVersion?: string;
}

function judgeKey(k: JudgeCacheKey): string {
  return `${k.contractVersion ?? 'v1'}:${k.dim}:${k.artifactJson.length}:${k.artifactJson.slice(0, 64)}`;
}

/** Judge 结果缓存(单例) */
const globalJudgeCache = new LRUCache<RubricScore[]>(50, 5 * 60 * 1000); // 5 分钟 TTL

/** 获取全局 Judge 缓存 */
export function getJudgeCache(): LRUCache<RubricScore[]> {
  return globalJudgeCache;
}

/** 生成 judge 缓存 key */
export function makeJudgeCacheKey(artifact: unknown, dim: string, contractVersion?: string): string {
  return judgeKey({ artifactJson: JSON.stringify(artifact), dim, contractVersion });
}
