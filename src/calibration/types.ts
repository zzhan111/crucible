/**
 * 校准模块类型(P1 §2.3-2.4 黄金集 + Kendall τ)。
 *
 * 黄金集 = 8 个冻结工件 + 人类排序。
 * judge 校准 = 用 judge 对 8 工件排序 vs 人类排序,算 Kendall τ。
 * 阈值:τ > 0.5 可接受,τ > 0.7 良好(PRD §6)。
 */
export interface GoldenArtifact {
  /** 工件唯一 ID(如 hk-3day-a) */
  id: string;
  /** 来源标签(q-traveller 种子区域) */
  region: 'hongkong' | 'yunnan' | 'fangchenggang';
  /** 质量梯度标签:供人类排序参考,不进 few-shot */
  quality_tier: 'high' | 'mid' | 'low';
  /** 工件本体 */
  artifact: unknown; // Artifact,用 unknown 避免循环依赖
}

/** 人类排序:工件 ID 列表,按优劣降序(第 0 个最优) */
export interface HumanRanking {
  /** 生成时间戳(ISO) */
  created_at: string;
  /** 排序后的工件 ID 列表 */
  ranking: string[];
  /** 排序维度说明 */
  dimension: string;
}

/** Kendall τ 校准报告 */
export interface CalibrationReport {
  /** 生成时间戳(ISO) */
  created_at: string;
  /** 整体 Kendall τ(judge final_score 排序 vs 人类排序) */
  overall_tau: number;
  /** 每个 judge 维度的 τ(若该维度有独立排序) */
  per_dim_tau: Record<string, number>;
  /** 判定:τ > 0.5 → pass,否则 fail */
  verdict: 'pass' | 'fail';
  /** 使用的阈值 */
  threshold: number;
  /** judge 排序(工件 ID 列表,按 final_score 降序) */
  judge_ranking: string[];
  /** 人类排序(同 HumanRanking.ranking) */
  human_ranking: string[];
}
