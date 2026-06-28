/**
 * P4.2.5 — 可插拔身份提供者(IdentityProvider)+ 会话解析。
 *
 * 履行 P4.2 RBAC 展望框的承诺:加 users + sessions 表,actor 从"外部传入字符串"
 * 升级为"会话 token 解析"。**但凭证(密码)委托给 IdP** — Crucible 不存密码,
 * 这匹配 on-prem ToB 现实(企业多用 SSO/LDAP,自建密码库是反模式 + 安全责任)。
 *
 * 设计:
 * - `IdentityProvider` 接口:token → Actor。生产由 LDAP/SSO provider 实现,
 *   demo/dev 用 `StaticTokenProvider`(查 sessions + users 表)。
 * - `resolveActorFromToken`:统一入口 — 查 sessions 验未过期 + users 拿 role → Actor。
 * - `ROLE_PERMISSIONS` 矩阵**不变**(P4.2 契约:权限逻辑稳定,变的只是 actor 来源)。
 *
 * spec ref: P4.2.5 plan;rbac.ts 头部"演进路径";PRD v1.2 §5 §7(ToB on-prem)。
 */
import type { DB } from '../persistence/db.js';
import type { Actor, Role } from './rbac.js';
import { SYSTEM_ACTOR } from './rbac.js';

/** 身份提供者:把会话 token 解析成 Actor。生产实现查 LDAP/SSO;dev 查本地 sessions 表。 */
export interface IdentityProvider {
  resolveActor(token: string): Promise<Actor | null>;
}

/**
 * 静态 token 提供者(dev/demo 用):查本地 sessions + users 表解析。
 * - token 必须在 sessions 表中存在且未过期(expires_at 为 null = 永不过期)
 * - user 必须在 users 表中存在
 * 返回 Actor(id=userId, role=users.role);任一不满足返回 null。
 */
export class StaticTokenProvider implements IdentityProvider {
  constructor(private readonly db: DB) {}

  async resolveActor(token: string): Promise<Actor | null> {
    const row = this.db.prepare(
      `SELECT s.user_id, u.role, s.expires_at
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token = ?`
    ).get(token) as { user_id: string; role: Role; expires_at: string | null } | undefined;

    if (!row) return null;
    // 过期检查:null = 永不过期;否则与当前 UTC 时间比
    if (row.expires_at !== null) {
      // sessions.expires_at 存 ISO datetime;SQLite datetime('now') 是 'YYYY-MM-DD HH:MM:SS'
      // 统一用字符串比较(ISO 8601 / SQLite datetime 字典序与时间序一致)
      const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
      if (row.expires_at < now) return null;
    }
    return { id: row.user_id, role: row.role };
  }
}

/**
 * 统一解析入口:经 provider 把 token 解析成 Actor。
 * - token 为空 → SYSTEM_ACTOR(向后兼容:无 token 的调用走 system/admin)
 * - 解析失败(未知/过期 token)→ null(调用方决定:拒绝 or 回退)
 */
export async function resolveActorFromToken(
  db: DB,
  provider: IdentityProvider,
  token: string | undefined | null
): Promise<Actor | null> {
  if (!token) return SYSTEM_ACTOR;
  return provider.resolveActor(token);
}

/** 创建一个会话 token(dev 用:测试/MCP demo 颁发临时 token)。 */
export function createSession(
  db: DB,
  userId: string,
  token: string,
  expiresAt: string | null = null
): void {
  db.prepare(
    `INSERT OR REPLACE INTO sessions (token, user_id, expires_at, created_at)
     VALUES (?, ?, ?, datetime('now'))`
  ).run(token, userId, expiresAt);
}

/** 创建一个用户(dev/seeding 用)。已存在则忽略。 */
export function createUser(
  db: DB,
  id: string,
  role: Role,
  displayName?: string
): void {
  db.prepare(
    `INSERT OR IGNORE INTO users (id, role, display_name) VALUES (?, ?, ?)`
  ).run(id, role, displayName ?? null);
}
