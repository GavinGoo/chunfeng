import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { getConfig } from '../config';
import { log } from '../log';
import { runMigrations } from './migrations';

// SQLite 连接（04 §5）：进程内单例，WAL 模式；首次打开时执行迁移。
// 用 globalThis 保存单例，避免开发模式热更新时重复打开连接。

const g = globalThis as typeof globalThis & { __chunfengDb?: Database.Database };

export function openDatabase(path: string): Database.Database {
  if (path !== ':memory:') mkdirSync(dirname(resolve(path)), { recursive: true });
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('busy_timeout = 5000');
  db.pragma('foreign_keys = ON');
  const applied = runMigrations(db);
  if (applied.length > 0) log().info({ evt: 'db.migrated', versions: applied });
  return db;
}

export function getDb(): Database.Database {
  g.__chunfengDb ??= openDatabase(getConfig().databasePath);
  return g.__chunfengDb;
}

/** 仅测试使用：关闭并丢弃单例 */
export function closeDbForTests(): void {
  g.__chunfengDb?.close();
  g.__chunfengDb = undefined;
}
