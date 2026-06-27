/**
 * P3.5 §2.3 — 新颖度检测算法 v2 (OQ-14)。
 *
 * P0 `src/agents/curator.ts` 的 `detectNovelty` 只做 state/node_type 的
 * string-set diff(字段值是否见过)。v2 在此基础上增加 3 个检测器,
 * 让自演化飞轮的关键门更健壮:
 *
 * 1. Schema-diff:artifact 出现 Contract 未定义的字段(field 名)。
 *    确定性,直接对比字段集。
 * 2. Distribution outlier:数值字段(cost/duration_min/source_trust)的 z-score
 *    偏离黄金集统计。确定性,基于黄金集均值/标准差。
 * 3. (可选) Embedding distance:本地嵌入距离。默认 OFF(env flag 开启)。
 *    本实现提供接口骨架但默认不加载模型,避免引入 50MB+ 依赖。
 *
 * 向后兼容:`detectNoveltyV2` 是新函数;旧 `detectNovelty`(curator.ts)签名
 * 不变,P0 curator 测试不破。v2 可被 workflow 选择性调用。
 *
 * spec ref: docs/superpowers/specs/crucible-p3.5-spec.md §2.3
 */
import type { Artifact, ArtifactNode } from '../predicates/types.js';
import type { ExpansionProposal } from '../agents/curator.js';

/** 数值字段默认监控集(可被调用方覆盖) */
export const DEFAULT_NUMERIC_FIELDS = ['cost', 'duration_min', 'source_trust'] as const;

/** z-score 超过此阈值视为分布异常(outlier)。经验值,黄金集标定后可调。 */
export const DEFAULT_Z_THRESHOLD = 2.5;

/** 黄金集统计:某数值字段的均值 + 标准差。 */
export interface FieldStats {
  mean: number;
  std: number;
  /** 样本数;std=0 或样本不足时该字段跳过 outlier 检测 */
  n: number;
}

/** 从一批 artifact 计算指定数值字段的统计。 */
export function computeFieldStats(
  artifacts: Artifact[],
  field: string
): FieldStats {
  const values: number[] = [];
  for (const a of artifacts) {
    for (const node of a.nodes) {
      const v = node[field];
      if (typeof v === 'number' && Number.isFinite(v)) values.push(v);
    }
  }
  const n = values.length;
  if (n === 0) return { mean: 0, std: 0, n: 0 };
  const mean = values.reduce((s, v) => s + v, 0) / n;
  const variance = n > 1
    ? values.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1)
    : 0;
  return { mean, std: Math.sqrt(variance), n };
}

/** 从黄金集批量计算多字段统计。 */
export function computeGoldenStats(
  golden: Artifact[],
  fields: readonly string[] = DEFAULT_NUMERIC_FIELDS
): Record<string, FieldStats> {
  const stats: Record<string, FieldStats> = {};
  for (const f of fields) stats[f] = computeFieldStats(golden, f);
  return stats;
}

// ───────────────────── detector 1: schema-diff ─────────────────────

/**
 * 检测 artifact 节点中出现的、Contract 已知字段集之外的字段名。
 * @param artifact 待检工件
 * @param knownFields Contract 已定义的字段名集合
 * @returns ExpansionProposal[] (dim='schema')
 */
export function detectSchemaNovelty(
  artifact: Artifact,
  knownFields: string[]
): ExpansionProposal[] {
  const known = new Set(knownFields);
  // 内置字段(每个节点都该有,不算 novelty)
  const builtin = new Set(['time_block', 'action', 'route']);
  const novel = new Set<string>();
  for (const node of artifact.nodes) {
    for (const key of Object.keys(node)) {
      if (!known.has(key) && !builtin.has(key)) novel.add(key);
    }
  }
  if (novel.size === 0) return [];
  const tokens = [...novel];
  return [{
    dim: 'state', // 复用 state dim 的扩展语义(见 proposals 表 dim CHECK);schema 作为子类
    tokens,
    rationale: `artifact contains field(s) not in Contract's schema: ${tokens.join(', ')}. Consider adding field definitions or marking as optional.`,
    proposed_constraint: ` Consider adding field def for: ${tokens.join(', ')}`,
  }];
}

// ───────────────────── detector 2: distribution outlier ─────────────────────

/**
 * 检测 artifact 数值字段是否偏离黄金集分布(z-score)。
 * @param artifact 待检工件
 * @param stats 黄金集字段统计(computeGoldenStats)
 * @param threshold z-score 阈值,默认 2.5
 * @param fields 监控字段,默认 DEFAULT_NUMERIC_FIELDS
 */
export function detectDistributionOutlier(
  artifact: Artifact,
  stats: Record<string, FieldStats>,
  threshold: number = DEFAULT_Z_THRESHOLD,
  fields: readonly string[] = DEFAULT_NUMERIC_FIELDS
): ExpansionProposal[] {
  const proposals: ExpansionProposal[] = [];
  const outliers: Record<string, number[]> = {};

  for (const field of fields) {
    const s = stats[field];
    if (!s || s.n < 2 || s.std === 0) continue; // 样本不足或无方差,跳过
    for (const node of artifact.nodes) {
      const v = node[field];
      if (typeof v !== 'number' || !Number.isFinite(v)) continue;
      const z = Math.abs((v - s.mean) / s.std);
      if (z > threshold) {
        (outliers[field] ??= []).push(v);
      }
    }
  }

  for (const [field, vals] of Object.entries(outliers)) {
    proposals.push({
      dim: 'state', // distribution 作为 state dim 的子类(proposals.dim CHECK 限定)
      tokens: vals.map(v => `${field}=${v}`),
      rationale: `field "${field}" has values [${vals.join(', ')}] that are statistical outliers (|z| > ${threshold}) relative to golden set (mean=${stats[field].mean.toFixed(2)}, std=${stats[field].std.toFixed(2)}). Investigate data quality or extend Contract tolerances.`,
    });
  }
  return proposals;
}

// ───────────────────── detector 3: embedding (skeleton, default OFF) ─────────────────────

/**
 * Embedding 距离检测器骨架。默认 OFF(CRUCIBLE_NOVELTY_EMBEDDING=1 才启用)。
 * 实际模型加载(@xenova/transformers ~22MB)留待后续迭代;此处提供接口与阈值约定,
 * 让 workflow 可条件性调用而无需改动调用点。
 *
 * 启用条件:env CRUCIBLE_NOVELTY_EMBEDDING=1 且已安装 @xenova/transformers。
 */
export function isEmbeddingDetectorEnabled(): boolean {
  return process.env.CRUCIBLE_NOVELTY_EMBEDDING === '1';
}

// ───────────────────── 统一入口: detectNoveltyV2 ─────────────────────

export interface NoveltyV2Options {
  /** Contract 已知 state tokens(传给旧 string-set 检测) */
  knownStates: string[];
  /** Contract 已知 node_type enum(可选) */
  knownNodeTypes?: string[];
  /** Contract 已知字段名(给 schema-diff 检测) */
  knownFields?: string[];
  /** 黄金集字段统计(给 distribution 检测);不传则跳过 distribution */
  goldenStats?: Record<string, FieldStats>;
  /** z-score 阈值 */
  zThreshold?: number;
}

export interface NoveltyV2Result {
  proposals: ExpansionProposal[];
  /** 各检测器是否触发(可观测) */
  detectors: {
    state_set: boolean;
    node_type_set: boolean;
    schema: boolean;
    distribution: boolean;
  };
}

/**
 * v2 统一新颖度检测。聚合 4 个检测器(旧 string-set × 2 + schema + distribution)。
 * embedding 检测器默认 OFF,启用时单独调用方处理。
 *
 * 旧 detectNovelty(artifact, knownStates, knownNodeTypes) 的超集:
 * 传入 knownStates/knownNodeTypes 即复刻旧行为,额外加 schema + distribution。
 */
export async function detectNoveltyV2(
  artifact: Artifact,
  opts: NoveltyV2Options
): Promise<NoveltyV2Result> {
  const proposals: ExpansionProposal[] = [];
  const detectors = { state_set: false, node_type_set: false, schema: false, distribution: false };

  // 1. 旧 state string-set(内联实现,避免循环依赖 curator.ts)
  const observedStates = new Set<string>();
  for (const node of artifact.nodes) {
    if (Array.isArray(node.state)) {
      for (const s of node.state) observedStates.add(String(s));
    }
  }
  const novelStates = [...observedStates].filter(s => !opts.knownStates.includes(s));
  if (novelStates.length > 0) {
    detectors.state_set = true;
    proposals.push({
      dim: 'state',
      tokens: novelStates,
      rationale: `artifact contains state tokens not in Contract's known set: ${novelStates.join(', ')}. Consider adding hard constraints or rubric dimensions for these.`,
      proposed_constraint: ` Consider adding mutex/dependency rules involving: ${novelStates.join(', ')}`,
    });
  }

  // 2. 旧 node_type string-set
  if (opts.knownNodeTypes) {
    const observedTypes = new Set<string>();
    for (const node of artifact.nodes) {
      if (node.node_type) observedTypes.add(String(node.node_type));
    }
    const novelTypes = [...observedTypes].filter(t => !opts.knownNodeTypes!.includes(t));
    if (novelTypes.length > 0) {
      detectors.node_type_set = true;
      proposals.push({
        dim: 'node_type',
        tokens: novelTypes,
        rationale: `artifact contains node_type values not in Contract's enum: ${novelTypes.join(', ')}. Consider extending the node_type enum or adding type-specific constraints.`,
      });
    }
  }

  // 3. schema-diff
  if (opts.knownFields) {
    const schemaProposals = detectSchemaNovelty(artifact, opts.knownFields);
    if (schemaProposals.length > 0) {
      detectors.schema = true;
      proposals.push(...schemaProposals);
    }
  }

  // 4. distribution outlier
  if (opts.goldenStats) {
    const distProposals = detectDistributionOutlier(
      artifact, opts.goldenStats, opts.zThreshold ?? DEFAULT_Z_THRESHOLD
    );
    if (distProposals.length > 0) {
      detectors.distribution = true;
      proposals.push(...distProposals);
    }
  }

  return { proposals, detectors };
}
