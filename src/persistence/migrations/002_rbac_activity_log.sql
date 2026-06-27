-- P4.2 migration v2: 企业内部 RBAC(actor 标识)+ 全量活动日志。
--
-- ⚠️ 非幂等:ALTER TABLE ADD COLUMN 不支持 IF NOT EXISTS(SQLite 限制)。
--   依赖 db.ts migrate() 的 schema_version 检查只跑一次。**不可手动重跑**。
--   测试一律用 :memory: 全新 DB(openAndMigrate),不在已迁移 DB 上重复执行。
--
-- 变更:
-- 1. score_runs 历史化:去掉 (artifact_hash, contract_version) UNIQUE 约束 →
--    改 append-only,同工件同契约多次评分全留(审计可追溯重评分)。
-- 2. 加 actor_id / tenant_id 列:actor_id 记"谁评分",tenant_id 轻量隔离列
--    (PRD §7 禁多租户 SaaS,on-prem 单租户,tenant_id 默认 'default',未来用)。
-- 3. proposals 加 approver_id / decided_at:记"谁审批契约变更"(RBAC 关键)。
-- 4. 加 created_at / gate_decision 索引:供全量活动日志时间窗查询。

-- 1. score_runs:加 actor_id + tenant_id,历史化
ALTER TABLE score_runs ADD COLUMN actor_id TEXT;
ALTER TABLE score_runs ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'default';

-- 去掉 (artifact_hash, contract_version) UNIQUE → 改 append-only
DROP INDEX IF EXISTS idx_score_runs_artifact_contract;
-- 新复合索引:租户 + 工件 + 时间倒序(审计查询主路径)
CREATE INDEX IF NOT EXISTS idx_score_runs_tenant_artifact_time
  ON score_runs(tenant_id, artifact_hash, created_at DESC);
-- 时间窗全量活动日志用
CREATE INDEX IF NOT EXISTS idx_score_runs_created_at
  ON score_runs(created_at);

-- 2. contracts:加 tenant_id(契约按租户隔离,虽然 on-prem 单租户)
ALTER TABLE contracts ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'default';

-- 3. ab_results:加 actor_id + tenant_id
ALTER TABLE ab_results ADD COLUMN actor_id TEXT;
ALTER TABLE ab_results ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'default';

-- 4. proposals:加 approver_id + decided_at(RBAC:谁审批契约变更)+ actor_id(谁提的)
ALTER TABLE proposals ADD COLUMN approver_id TEXT;
ALTER TABLE proposals ADD COLUMN decided_at TEXT;
ALTER TABLE proposals ADD COLUMN actor_id TEXT;
-- gate_decision 索引:listPendingProposals / 审批流查询用
CREATE INDEX IF NOT EXISTS idx_proposals_gate
  ON proposals(gate_decision);
