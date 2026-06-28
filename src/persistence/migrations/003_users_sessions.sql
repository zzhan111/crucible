-- P4.2.5 migration v3: users + sessions(可插拔身份,RBAC stub)。
--
-- ⚠️ 非幂等:ALTER/CREATE 靠 schema_version 只跑一次。**不可手动重跑**。
--   测试用 :memory: 全新 DB(openAndMigrate)。
--
-- 设计:
-- - users 表:角色 + 显示名。**无 password_hash 列** — 凭证委托给可插拔 IdentityProvider
--   (on-prem ToB 企业多用 SSO/LDAP,Crucible 不存密码,避免安全责任)。
-- - sessions 表:token → user 映射 + 过期。token 由外部 IdP 颁发或 dev stub 生成。
-- - 种子 system 用户(role=admin):保证 P4.2 落库的 actor_id='system' 行逻辑 FK 有效。
--
-- spec ref: P4.2.5 plan;rbac.ts 头部"演进路径"承诺("users + sessions + 可插拔 IdP")。
--           PRD v1.2 §5 §7(ToB on-prem 单租户)。

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,                    -- 用户标识(外部 IdP 同步或 dev 指定)
  role TEXT NOT NULL CHECK(role IN ('admin','author','approver','viewer')),
  display_name TEXT,                      -- 显示名(审计报告友好展示)
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,                 -- 会话 token(IdP 颁发或 dev stub)
  user_id TEXT NOT NULL REFERENCES users(id),
  expires_at TEXT,                        -- ISO datetime,null = 永不过期
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

-- 种子:system 用户(admin 全权),保证现存 actor_id='system' 行有效
INSERT OR IGNORE INTO users (id, role, display_name) VALUES ('system', 'admin', 'System (auto)');
