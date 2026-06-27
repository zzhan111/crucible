/**
 * P3.5 §2.2 — SQLite 持久化层。
 *
 * 设计原则:
 * - 持久化是 **sink**(只写历史),不替换 LRU 热缓存(P3 cache 命中路径零变化)。
 * - 同步 API(better-sqlite3),与 P3 的同步 scorer/cache 风格一致,避免 async 传染。
 * - schema 用 SQL migration 脚本顺序执行;idempotent(CREATE TABLE IF NOT EXISTS)。
 * - 默认 :memory: 供测试,生产传文件路径。
 *
 * spec ref: docs/superpowers/specs/crucible-p3.5-spec.md §2.2
 */
import Database from 'better-sqlite3';
import type { Database as BetterSqlite3Database } from 'better-sqlite3';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, readdirSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

export type DB = BetterSqlite3Database;

/**
 * 打开 / 创建持久化数据库。
 * @param path 数据库文件路径;默认 ':memory:'(测试用)。生产传文件路径。
 */
export function openDB(path: string = ':memory:'): DB {
  const db = new Database(path);
  // WAL 提升并发写(文件模式);memory 模式下 no-op。
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  return db;
}

/**
 * 顺序执行 migrations 目录下的 .sql 文件。
 * 用 schema_version 表记录已执行版本(idempotent)。
 */
export function migrate(db: DB): void {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL
  );`);

  const migrationsDir = join(__dirname, 'migrations');
  let files: string[];
  try {
    files = readdirSync(migrationsDir)
      .filter(f => f.endsWith('.sql'))
      .sort();
  } catch {
    return; // 无 migration 目录,跳过(早期/测试场景)
  }

  const applied = new Set(
    (db.prepare('SELECT version FROM schema_version').all() as Array<{ version: number }>)
      .map(r => r.version)
  );

  files.forEach((file, idx) => {
    const version = idx + 1;
    if (applied.has(version)) return;
    const sql = readFileSync(join(migrationsDir, file), 'utf8');
    db.exec(sql);
    db.prepare('INSERT INTO schema_version (version, applied_at) VALUES (?, ?)')
      .run(version, new Date().toISOString());
  });
}

/** 测试/开发便利:打开 + 迁移一步完成。 */
export function openAndMigrate(path: string = ':memory:'): DB {
  const db = openDB(path);
  migrate(db);
  return db;
}

/**
 * P4.1 审计轨迹:打开生产审计 DB(从 env 读路径)。
 *
 * - `CRUCIBLE_DB_PATH` 未设 → 返回 null(调用方跳过落库,行为零变化)。
 * - 设了 → 打开文件 DB 并 migrate,供审计写/查。
 *
 * 这样把"是否落库"做成显式 opt-in:默认不落库(P3 行为零变化),
 * 想要审计轨迹就 `CRUCIBLE_DB_PATH=./crucible-audit.db`。
 */
export function openAuditDB(): DB | null {
  const path = process.env.CRUCIBLE_DB_PATH;
  if (!path) return null;
  return openAndMigrate(path);
}
