/**
 * P3.5 §2.2 — 持久化 repository 层。
 *
 * 4 个表的 typed insert/query。复用 P3 的 scorerCacheKey 作为 artifact_hash
 * (cache 与 sink 用同一 hash 语义,key 一致便于对账)。
 *
 * 所有写入是 sink:调用方决定何时落库(不在热路径强制写)。读路径给历史查询用。
 *
 * spec ref: docs/superpowers/specs/crucible-p3.5-spec.md §2.2
 */
import { z } from 'zod';
import type { DB } from './db.js';
import { scorerCacheKey } from '../cache/scorer-cache.js';
import type { ScoreReport } from '../scorer/types.js';
import type { ABResult } from '../ab/comparison.js';
import type { ExpansionProposal } from '../agents/curator.js';

// ───────────────────── 输入 zod schemas ─────────────────────

export const ContractRecordInput = z.object({
  version: z.number().int().positive(),
  family: z.string().min(1),
  yaml_text: z.string().min(1),
  parent_version: z.number().int().positive().nullable().optional(),
  diff_summary: z.string().nullable().optional(),
  tenant_id: z.string().optional(), // P4.2: 轻量租户列,默认 'default'
});
export type ContractRecord = z.infer<typeof ContractRecordInput>;

export const ScoreRunInput = z.object({
  artifact: z.unknown(),
  contract_version: z.number().int().positive(),
  report: z.any(), // ScoreReport,JSON 序列化
});
export type ScoreRunRecord = z.infer<typeof ScoreRunInput>;

// ───────────────────── artifact hash ─────────────────────

/**
 * 计算 artifact 持久化 hash。复用 scorerCacheKey 的 hash(artifact JSON) 语义,
 * 但**不含 contract version** — 持久化层 (artifact_hash, contract_version) 是联合键,
 * artifact_hash 本身只标识工件。
 */
export function artifactHash(artifact: unknown): string {
  // scorerCacheKey 拼了 version;这里传固定占位再截取,保证纯 artifact hash 稳定。
  // 直接用 createHash 更清晰,但复用保证 hash 算法一致(sha256, 16 hex)。
  return scorerCacheKey(artifact, '');
}

// ───────────────────── contracts ─────────────────────

export function insertContract(db: DB, r: ContractRecord): void {
  ContractRecordInput.parse(r);
  db.prepare(
    `INSERT OR REPLACE INTO contracts (version, family, yaml_text, parent_version, diff_summary, tenant_id, created_at)
     VALUES (@version, @family, @yaml_text, @parent_version, @diff_summary, @tenant_id, datetime('now'))`
  ).run({
    version: r.version,
    family: r.family,
    yaml_text: r.yaml_text,
    parent_version: r.parent_version ?? null,
    diff_summary: r.diff_summary ?? null,
    tenant_id: r.tenant_id ?? 'default',
  });
}

export function getContract(db: DB, version: number): ContractRecord | undefined {
  const row = db.prepare('SELECT * FROM contracts WHERE version = ?').get(version) as
    | (Omit<ContractRecord, 'parent_version' | 'diff_summary'> & { parent_version: number | null; diff_summary: string | null })
    | undefined;
  if (!row) return undefined;
  return {
    version: row.version,
    family: row.family,
    yaml_text: row.yaml_text,
    parent_version: row.parent_version,
    diff_summary: row.diff_summary,
  };
}

export function listContracts(db: DB): ContractRecord[] {
  return (db.prepare('SELECT * FROM contracts ORDER BY version ASC').all() as Array<
    ContractRecord & { parent_version: number | null; diff_summary: string | null }
  >).map(r => ({
    version: r.version,
    family: r.family,
    yaml_text: r.yaml_text,
    parent_version: r.parent_version,
    diff_summary: r.diff_summary,
  }));
}

// ───────────────────── score_runs ─────────────────────

/**
 * P4.2: append-only 历史(不再 INSERT OR REPLACE)。
 * 同工件同契约多次评分全留,审计可追溯重评分。
 * actor_id/tenant_id 由调用方传入(P4.1 不传时默认 'system'/'default',向后兼容)。
 */
export function insertScoreRun(
  db: DB,
  artifact: unknown,
  contractVersion: number,
  report: ScoreReport,
  actorId: string = 'system',
  tenantId: string = 'default'
): void {
  const hash = artifactHash(artifact);
  const judgeScore = report.judge ? report.judge.overall_score : null;
  db.prepare(
    `INSERT INTO score_runs (artifact_hash, contract_version, report_json, det_score, judge_score, actor_id, tenant_id, created_at)
     VALUES (@hash, @version, @report, @det, @judge, @actor, @tenant, datetime('now'))`
  ).run({
    hash,
    version: contractVersion,
    report: JSON.stringify(report),
    det: report.deterministic.deterministic_score,
    judge: judgeScore,
    actor: actorId,
    tenant: tenantId,
  });
}

/**
 * 取某工件+某契约的评分报告。
 * P4.2 append-only 后同 (artifact, contract_version) 可有多条 — 取最新一条(ORDER BY created_at DESC LIMIT 1)。
 */
export function getScoreRun(
  db: DB,
  artifact: unknown,
  contractVersion: number
): ScoreReport | undefined {
  const hash = artifactHash(artifact);
  const row = db.prepare(
    'SELECT report_json FROM score_runs WHERE artifact_hash = ? AND contract_version = ? ORDER BY created_at DESC LIMIT 1'
  ).get(hash, contractVersion) as { report_json: string } | undefined;
  return row ? (JSON.parse(row.report_json) as ScoreReport) : undefined;
}

// ───────────────────── ab_results ─────────────────────

export function insertABResult(
  db: DB,
  championVersion: number,
  challengerVersion: number,
  result: ABResult
): void {
  db.prepare(
    `INSERT INTO ab_results (champion_version, challenger_version, tau_champ, tau_chall, verdict, created_at)
     VALUES (@champ, @chall, @tauC, @tauH, @verdict, datetime('now'))`
  ).run({
    champ: championVersion,
    chall: challengerVersion,
    tauC: result.champion_tau,
    tauH: result.challenger_tau,
    verdict: result.verdict,
  });
}

export function listABResults(db: DB): Array<{
  champion_version: number;
  challenger_version: number;
  tau_champ: number;
  tau_chall: number;
  verdict: 'promote' | 'retain';
  created_at: string;
}> {
  return db.prepare('SELECT champion_version, challenger_version, tau_champ, tau_chall, verdict, created_at FROM ab_results ORDER BY id DESC').all() as Array<{
    champion_version: number;
    challenger_version: number;
    tau_champ: number;
    tau_chall: number;
    verdict: 'promote' | 'retain';
    created_at: string;
  }>;
}

// ───────────────────── proposals ─────────────────────

export type ProposalDim = 'state' | 'node_type' | 'schema' | 'distribution' | 'embedding';
export type GateDecision = 'pending' | 'approved' | 'rejected';

export function insertProposal(
  db: DB,
  artifact: unknown,
  contractVersion: number,
  proposal: ExpansionProposal,
  actorId: string = 'system'
): void {
  const hash = artifactHash(artifact);
  db.prepare(
    `INSERT INTO proposals (artifact_hash, contract_version, dim, tokens_json, rationale, gate_decision, actor_id, created_at)
     VALUES (@hash, @version, @dim, @tokens, @rationale, 'pending', @actor, datetime('now'))`
  ).run({
    hash,
    version: contractVersion,
    dim: proposal.dim as ProposalDim,
    tokens: JSON.stringify(proposal.tokens),
    rationale: proposal.rationale ?? null,
    actor: actorId,
  });
}

export function updateProposalGate(
  db: DB,
  proposalId: number,
  decision: GateDecision,
  approverId: string = 'system'
): void {
  // P4.2: 记谁审批 + 何时审批(RBAC 审计)
  db.prepare(
    `UPDATE proposals SET gate_decision = ?, approver_id = ?, decided_at = datetime('now') WHERE id = ?`
  ).run(decision, approverId, proposalId);
}

export function listPendingProposals(db: DB): Array<{
  id: number;
  artifact_hash: string;
  contract_version: number;
  dim: ProposalDim;
  tokens: string[];
  rationale: string | null;
}> {
  const rows = db.prepare(
    'SELECT id, artifact_hash, contract_version, dim, tokens_json, rationale FROM proposals WHERE gate_decision = ?'
  ).all('pending') as Array<{
    id: number;
    artifact_hash: string;
    contract_version: number;
    dim: ProposalDim;
    tokens_json: string;
    rationale: string | null;
  }>;
  return rows.map(r => ({ ...r, tokens: JSON.parse(r.tokens_json) as string[] }));
}

// ───────────────────── P4.2 全量活动日志 ─────────────────────

/** 活动日志查询选项(全部可选,组合过滤)。 */
export interface ActivityLogOptions {
  tenantId?: string;   // 默认不过滤(查全租户;on-prem 单租户通常 'default')
  actorId?: string;    // 按"谁"过滤
  since?: string;      // ISO/datetime 起始(含)
  until?: string;      // ISO/datetime 截止(含)
  limit?: number;      // 默认 200
}

/** 活动日志条目:统一 score_runs + proposals 两种事件。 */
export interface ActivityLogEntry {
  at: string;                // created_at
  actor_id: string | null;
  event: 'score_run' | 'proposal';
  artifact_hash: string;
  contract_version: number;
  // score_run 专属
  det_score?: number | null;
  judge_score?: number | null;
  // proposal 专属
  dim?: string;
  gate_decision?: string | null;
  approver_id?: string | null;
}

/**
 * 全量活动日志:score_runs(评分)+ proposals(提议/审批)按时间倒序合并。
 * 支持 tenant/actor/时间窗过滤。这是 P4.2 的核心审计查询 — 回答
 * "谁在什么时候对哪个工件做了什么(评分/提议/审批)"。
 */
export function listActivityLog(db: DB, opts: ActivityLogOptions = {}): ActivityLogEntry[] {
  const tenant = opts.tenantId;
  const actor = opts.actorId;
  const since = opts.since;
  const until = opts.until;
  const limit = opts.limit ?? 200;

  // 评分事件
  const scoreSql = `SELECT created_at AS at, actor_id, artifact_hash, contract_version, det_score, judge_score, 'score_run' AS event
    FROM score_runs
    WHERE 1=1
      ${tenant ? 'AND tenant_id = @tenant' : ''}
      ${actor ? 'AND actor_id = @actor' : ''}
      ${since ? "AND created_at >= @since" : ''}
      ${until ? "AND created_at <= @until" : ''}`;
  const scoreRows = db.prepare(scoreSql).all({
    tenant: tenant ?? null, actor: actor ?? null, since: since ?? null, until: until ?? null,
  }) as Array<{ at: string; actor_id: string | null; artifact_hash: string; contract_version: number; det_score: number; judge_score: number | null; event: 'score_run' }>;

  // 提议/审批事件
  const propSql = `SELECT created_at AS at, actor_id, artifact_hash, contract_version, dim, gate_decision, approver_id, 'proposal' AS event
    FROM proposals
    WHERE 1=1
      ${since ? "AND created_at >= @since" : ''}
      ${until ? "AND created_at <= @until" : ''}
      ${actor ? 'AND (actor_id = @actor OR approver_id = @actor)' : ''}`;
  const propRows = db.prepare(propSql).all({
    actor: actor ?? null, since: since ?? null, until: until ?? null,
  }) as Array<{ at: string; actor_id: string | null; artifact_hash: string; contract_version: number; dim: string; gate_decision: string | null; approver_id: string | null; event: 'proposal' }>;

  // 合并 + 时间倒序 + limit
  const all: ActivityLogEntry[] = [
    ...scoreRows.map(r => ({ at: r.at, actor_id: r.actor_id, event: 'score_run' as const, artifact_hash: r.artifact_hash, contract_version: r.contract_version, det_score: r.det_score, judge_score: r.judge_score })),
    ...propRows.map(r => ({ at: r.at, actor_id: r.actor_id, event: 'proposal' as const, artifact_hash: r.artifact_hash, contract_version: r.contract_version, dim: r.dim, gate_decision: r.gate_decision, approver_id: r.approver_id })),
  ];
  all.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  return all.slice(0, limit);
}
