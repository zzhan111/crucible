import { describe, it, expect, beforeEach } from 'vitest';
import { openAndMigrate, type DB } from '../../src/persistence/db.js';
import {
  StaticTokenProvider,
  resolveActorFromToken,
  createSession,
  createUser,
} from '../../src/auth/identity-provider.js';
import { SYSTEM_ACTOR } from '../../src/auth/rbac.js';

describe('P4.2.5 可插拔身份提供者(users+sessions+IdP)', () => {
  let db: DB;
  beforeEach(() => {
    db = openAndMigrate(); // :memory:,跑 001+002+003
  });

  describe('003 migration', () => {
    it('users + sessions 表存在', () => {
      const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>).map(t => t.name);
      expect(tables).toContain('users');
      expect(tables).toContain('sessions');
    });
    it('system 用户种子存在(role=admin)', () => {
      const u = db.prepare('SELECT role FROM users WHERE id=?').get('system') as { role: string } | undefined;
      expect(u).toBeDefined();
      expect(u!.role).toBe('admin');
    });
    it('schema_version 记录 v1+v2+v3+v4', () => {
      const versions = (db.prepare('SELECT version FROM schema_version ORDER BY version').all() as Array<{ version: number }>).map(r => r.version);
      expect(versions).toEqual([1, 2, 3, 4]);
    });
  });

  describe('StaticTokenProvider', () => {
    it('有效 token + 未过期 → 返回 Actor', async () => {
      createUser(db, 'alice', 'author', 'Alice');
      createSession(db, 'alice', 'tok-alice-1');
      const provider = new StaticTokenProvider(db);
      const actor = await provider.resolveActor('tok-alice-1');
      expect(actor).toEqual({ id: 'alice', role: 'author' });
    });

    it('未知 token → null', async () => {
      const provider = new StaticTokenProvider(db);
      expect(await provider.resolveActor('nonexistent')).toBeNull();
    });

    it('过期 token → null', async () => {
      createUser(db, 'bob', 'viewer', 'Bob');
      // expires_at 在过去
      createSession(db, 'bob', 'tok-bob-expired', '2020-01-01 00:00:00');
      const provider = new StaticTokenProvider(db);
      expect(await provider.resolveActor('tok-bob-expired')).toBeNull();
    });

    it('expires_at=null → 永不过期', async () => {
      createUser(db, 'carol', 'approver', 'Carol');
      createSession(db, 'carol', 'tok-carol', null);
      const provider = new StaticTokenProvider(db);
      const actor = await provider.resolveActor('tok-carol');
      expect(actor).toEqual({ id: 'carol', role: 'approver' });
    });

    it('token 存在但 user 不存在(JOIN 失败)→ null', async () => {
      // 直接插 sessions 不经 createUser,违反 FK — 但 foreign_keys=ON 会阻止
      expect(() => createSession(db, 'ghost', 'tok-ghost')).toThrow();
    });
  });

  describe('resolveActorFromToken', () => {
    it('token 为空 → SYSTEM_ACTOR(向后兼容)', async () => {
      const provider = new StaticTokenProvider(db);
      expect(await resolveActorFromToken(db, provider, undefined)).toEqual(SYSTEM_ACTOR);
      expect(await resolveActorFromToken(db, provider, '')).toEqual(SYSTEM_ACTOR);
      expect(await resolveActorFromToken(db, provider, null)).toEqual(SYSTEM_ACTOR);
    });

    it('有效 token → 解析的 Actor', async () => {
      createUser(db, 'dave', 'admin', 'Dave');
      createSession(db, 'dave', 'tok-dave');
      const provider = new StaticTokenProvider(db);
      expect(await resolveActorFromToken(db, provider, 'tok-dave')).toEqual({ id: 'dave', role: 'admin' });
    });

    it('无效 token → null(调用方可决定拒绝或回退)', async () => {
      const provider = new StaticTokenProvider(db);
      expect(await resolveActorFromToken(db, provider, 'bad-token')).toBeNull();
    });
  });

  describe('createUser / createSession 幂等', () => {
    it('createUser 重复 id → 忽略(INSERT OR IGNORE),不抛', () => {
      createUser(db, 'eve', 'author');
      createUser(db, 'eve', 'approver'); // 同 id,role 不同 — 应被忽略
      const u = db.prepare('SELECT role FROM users WHERE id=?').get('eve') as { role: string };
      expect(u.role).toBe('author'); // 第一次的值保留
    });

    it('createSession 同 token → 替换(INSERT OR REPLACE)', () => {
      createUser(db, 'frank', 'author');
      createSession(db, 'frank', 'tok-frank');
      createSession(db, 'frank', 'tok-frank'); // 同 token 重发
      const count = (db.prepare('SELECT COUNT(*) c FROM sessions WHERE token=?').get('tok-frank') as { c: number }).c;
      expect(count).toBe(1);
    });
  });
});
