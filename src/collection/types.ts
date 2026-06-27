import type { Artifact } from '../predicates/types.js';

/**
 * 采集层类型(P2 §2.2)。
 *
 * 外部数据源(BigSet 报告 / 旅游攻略文本)→ Crucible 内部 Artifact 格式。
 * 适配器负责转换,Collector 负责编排(调用适配器 + 返回 Artifact)。
 */

/** 外部原始数据(适配器特定格式) */
export type RawArtifact = unknown;

/** 采集源类型 */
export type CollectionSource = 'bigset' | 'travel-guide' | 'custom';

/** 适配器接口: RawArtifact → Artifact */
export interface ArtifactAdapter {
  /** 采集源标识 */
  source: CollectionSource;
  /** 适配器名称 */
  name: string;
  /** 把原始数据转为 Artifact */
  adapt(raw: RawArtifact): Artifact;
  /** 校验原始数据格式(返回 null=合法, string=错误信息) */
  validate(raw: RawArtifact): string | null;
}

/** 采集结果 */
export interface CollectionResult {
  artifact: Artifact;
  source: CollectionSource;
  adapter: string;
  warnings: string[];
}

/**
 * Collector: 编排适配器,从原始数据采集 Artifact。
 * P2 实现为同步适配器调用(不实际 fetch 网络,真实 fork 留 P3)。
 */
export interface Collector {
  /** 采集源 */
  source: CollectionSource;
  /** 从原始数据采集(调用适配器转换) */
  collect(raw: RawArtifact): CollectionResult;
}
