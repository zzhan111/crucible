/**
 * P4.1 — 持久化写接入(audit sink)。
 *
 * P3.5 建好了 persistence 层(4 表 + repository),但**生产代码从不落库**。
 * 本模块把"打分结果落库"封装成一处薄调用,供 workflow 接入,产出真实审计轨迹。
 *
 * 关键修复:契约版本规范化。
 * `augmented.ts:26` 把 contractVersion 读成 string(`'v1'` 默认),但 score_runs.contract_version
 * 是 INTEGER + FK 到 contracts(version)。这里在落库前把版本规范化为 number:
 * - 有 metadata.version → 用它(必须 ≥1 的整数)
 * - 无 → 默认 1(不是 'v1')
 * - <1 或非整数 → 抛错(不静默写脏数据,FK 会爆)
 *
 * spec ref: docs/superpowers/specs/crucible-p3.5-spec.md §2.2
 *           PRD v1.2 §6 审计轨迹(出处+分数=可辩护)
 */
import { stringify as stringifyYaml } from 'yaml';
import type { DB } from './db.js';
import type { Contract } from '../contract/schema.js';
import type { ScoreReport } from '../scorer/types.js';
import { insertContract, insertScoreRun } from './repositories.js';

type ContractWithMeta = Contract & { metadata?: { version?: unknown } };

/**
 * 从 contract.metadata.version 解析出持久化用的整数版本号。
 * - 无 metadata → 1(默认基线版本,对应 travel-sequence-v1.yaml 无 metadata 块的情况)
 * - 有但非法(NaN / <1 / 非整数)→ 抛错
 */
export function resolveContractVersion(contract: Contract): number {
  const raw = (contract as ContractWithMeta).metadata?.version;
  if (raw === undefined || raw === null) return 1;
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(
      `resolveContractVersion: 非法契约版本 ${JSON.stringify(raw)}(需 ≥1 的整数,FK 指向 contracts.version)`
    );
  }
  return n;
}

/**
 * 把一次打分结果落库(contract + score_run 都写,幂等)。
 *
 * - 先 insertContract(INSERT OR REPLACE,重跑安全;parent_version/diff_summary 暂留 null,
 *   契约演化的谱系由 P3 human-gate 流程另行记录,审计只关心"哪版契约评的")
 * - 再 insertScoreRun(INSERT OR REPLACE on (artifact_hash, contract_version),
 *   只留最新一次评分 — 重评分不累积历史,这是 P3.5 schema 的设计取舍,留 P4.2 改)
 *
 * 调用方负责传入有效 db(由 openAuditDB() 决定是否落库)。
 */
export function persistScoreRun(
  db: DB,
  artifact: unknown,
  contract: Contract,
  report: ScoreReport
): void {
  const version = resolveContractVersion(contract);
  insertContract(db, {
    version,
    family: contract.artifact_family,
    yaml_text: stringifyYaml(contract),
    parent_version: null,
    diff_summary: null,
  });
  insertScoreRun(db, artifact, version, report);
}
