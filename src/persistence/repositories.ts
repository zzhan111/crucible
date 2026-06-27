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
    `INSERT OR REPLACE INTO contracts (version, family, yaml_text, parent_version, diff_summary, created_at)
     VALUES (@version, @family, @yaml_text, @parent_version, @diff_summary, datetime('now'))`
  ).run({
    version: r.version,
    family: r.family,
    yaml_text: r.yaml_text,
    parent_version: r.parent_version ?? null,
    diff_summary: r.diff_summary ?? null,
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

export function insertScoreRun(
  db: DB,
  artifact: unknown,
  contractVersion: number,
  report: ScoreReport
): void {
  const hash = artifactHash(artifact);
  const judgeScore = report.judge ? report.judge.overall_score : null;
  db.prepare(
    `INSERT OR REPLACE INTO score_runs (artifact_hash, contract_version, report_json, det_score, judge_score, created_at)
     VALUES (@hash, @version, @report, @det, @judge, datetime('now'))`
  ).run({
    hash,
    version: contractVersion,
    report: JSON.stringify(report),
    det: report.deterministic.deterministic_score,
    judge: judgeScore,
  });
}

export function getScoreRun(
  db: DB,
  artifact: unknown,
  contractVersion: number
): ScoreReport | undefined {
  const hash = artifactHash(artifact);
  const row = db.prepare(
    'SELECT report_json FROM score_runs WHERE artifact_hash = ? AND contract_version = ?'
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
  proposal: ExpansionProposal
): void {
  const hash = artifactHash(artifact);
  db.prepare(
    `INSERT INTO proposals (artifact_hash, contract_version, dim, tokens_json, rationale, gate_decision, created_at)
     VALUES (@hash, @version, @dim, @tokens, @rationale, 'pending', datetime('now'))`
  ).run({
    hash,
    version: contractVersion,
    dim: proposal.dim as ProposalDim,
    tokens: JSON.stringify(proposal.tokens),
    rationale: proposal.rationale ?? null,
  });
}

export function updateProposalGate(
  db: DB,
  proposalId: number,
  decision: GateDecision
): void {
  db.prepare('UPDATE proposals SET gate_decision = ? WHERE id = ?').run(decision, proposalId);
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
