/**
 * P4.1 — 审计轨迹查询层(工件为中心,只读)。
 *
 * 在 P3.5 persistence 之上建只读查询,把"某工件被哪版契约、按什么标准、打了多少分、
 * 违规在哪、来源可信度多少"组装成一份可辩驳的审计轨迹。
 *
 * 设计:
 * - 工件视角 = `WHERE artifact_hash = ?`,命中现有 unique index,不 table-scan,无需新索引。
 * - 不加 migration(P4.2 若做全量活动日志时间窗查询再加 created_at 索引)。
 * - source_trust 单独抽出来高亮:它是 PRD §6 企业付费核心(出处+分数=可辩护)。
 *
 * spec ref: PRD v1.2 §6 审计轨迹;P3.5 §2.2 persistence schema
 */
import type { DB } from './db.js';
import { artifactHash, getContract, listActivityLog } from './repositories.js';
import type { ActivityLogEntry, ActivityLogOptions } from './repositories.js';
import type { RubricScore } from '../rubric/types.js';
import type { Violation } from '../predicates/types.js';

/** 一行 score_runs 原始记录(未解析 report_json)。 */
export interface ScoreRunRow {
  contract_version: number;
  det_score: number;
  judge_score: number | null;
  report_json: string;
  created_at: string;
  actor_id: string | null;  // P4.2: 谁触发的评分
}

/** 一次评分的审计视图(已从 report_json 解析出维度分/违规/来源可信度)。 */
export interface AuditRun {
  contract_version: number;
  family: string;           // 来自 contracts 表,工件族(sequence/table/...)
  scored_at: string;        // score_runs.created_at(SQLite datetime,UTC)
  det_score: number;
  judge_score: number | null;
  final_score: number;
  rubric_scores: RubricScore[];   // deterministic + judge 合并
  violations: Violation[];
  hard_violation_count: number;
  /** source_trust 维度分(从 rubric_scores 抽出,无则 null)。企业审计核心。 */
  source_trust: number | null;
  /** P4.2: 谁触发的这次评分(actor 标识)。 */
  actor_id: string | null;
}

/** 工件审计轨迹 = 一工件 × 多次评分(不同契约版本)。 */
export interface ArtifactAuditTrail {
  artifact_hash: string;
  runs: AuditRun[];
}

/**
 * 列出某工件的所有评分记录(按时间倒序)。
 * 复用 artifactHash 保证 hash 语义与写入侧一致。
 * P4.2: append-only 后同工件同版本可有多条(重评分历史全留);按 tenant 隔离。
 */
export function listScoreRunsForArtifact(
  db: DB,
  artifact: unknown,
  tenantId: string = 'default'
): ScoreRunRow[] {
  const hash = artifactHash(artifact);
  return db.prepare(
    `SELECT contract_version, det_score, judge_score, report_json, created_at, actor_id
     FROM score_runs
     WHERE artifact_hash = ? AND tenant_id = ?
     ORDER BY created_at DESC`
  ).all(hash, tenantId) as ScoreRunRow[];
}

/**
 * 组装工件审计轨迹:每个 score_run JOIN contracts 拿 family,解析 report_json
 * 抽出 rubric_scores / violations / source_trust / actor_id。
 *
 * @returns 无评分记录时返回 undefined(调用方据此提示"未跑过 workflow")
 */
export function getArtifactAuditTrail(
  db: DB,
  artifact: unknown,
  tenantId: string = 'default'
): ArtifactAuditTrail | undefined {
  const hash = artifactHash(artifact);
  const rows = listScoreRunsForArtifact(db, artifact, tenantId);
  if (rows.length === 0) return undefined;

  const runs: AuditRun[] = rows.map(row => {
    // report_json 是写入侧 JSON.stringify(ScoreReport)
    const report = JSON.parse(row.report_json) as {
      deterministic: { violations: Violation[]; rubric_scores: RubricScore[]; hard_violation_count: number; deterministic_score: number };
      judge: { rubric_scores: RubricScore[]; overall_score: number } | null;
      final_score: number;
    };
    const contract = getContract(db, row.contract_version);
    const detScores = report.deterministic.rubric_scores;
    const judgeScores = report.judge?.rubric_scores ?? [];
    const allRubric = [...detScores, ...judgeScores];
    const sourceTrustEntry = allRubric.find(r => r.dim === 'source_trust');

    return {
      contract_version: row.contract_version,
      family: contract?.family ?? 'unknown',
      scored_at: row.created_at,
      det_score: row.det_score,
      judge_score: row.judge_score,
      final_score: report.final_score,
      rubric_scores: allRubric,
      violations: report.deterministic.violations,
      hard_violation_count: report.deterministic.hard_violation_count,
      source_trust: sourceTrustEntry ? sourceTrustEntry.score : null,
      actor_id: row.actor_id,
    };
  });

  return { artifact_hash: hash, runs };
}

/**
 * P4.2 全量活动日志(转发 repositories.listActivityLog)。
 * 回答"谁在何时对哪个工件做了什么(评分/提议/审批)"— 企业审计核心。
 */
export function getActivityLog(db: DB, opts: ActivityLogOptions = {}): ActivityLogEntry[] {
  return listActivityLog(db, opts);
}
