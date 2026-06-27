import type { Artifact } from '../predicates/types.js';
import type { Collector, CollectionResult, CollectionSource, RawArtifact } from './types.js';
import { bigsetAdapter } from './bigset-adapter.js';
import { travelAdapter } from './travel-adapter.js';

/** 适配器注册表 */
const ADAPTERS: Record<CollectionSource, typeof bigsetAdapter> = {
  bigset: bigsetAdapter,
  'travel-guide': travelAdapter,
  custom: travelAdapter, // custom 复用 travel 结构
};

/**
 * createCollector: 创建采集器(P2 §2.2)。
 * 调用适配器把原始数据转为 Artifact。
 */
export function createCollector(source: CollectionSource): Collector {
  return {
    source,
    collect(raw: RawArtifact): CollectionResult {
      const adapter = ADAPTERS[source];
      const warnings: string[] = [];

      const validationError = adapter.validate(raw);
      if (validationError) {
        warnings.push(`validation: ${validationError}`);
        // 返回空 artifact(让 Scorer 抓违规,不 crash)
        return {
          artifact: { family: source === 'bigset' ? 'table' : 'sequence', nodes: [] } as Artifact,
          source,
          adapter: adapter.name,
          warnings,
        };
      }

      const artifact = adapter.adapt(raw);
      return { artifact, source, adapter: adapter.name, warnings };
    },
  };
}

/** 便捷函数: 直接采集(不手动建 collector) */
export function collectArtifact(source: CollectionSource, raw: RawArtifact): CollectionResult {
  return createCollector(source).collect(raw);
}
