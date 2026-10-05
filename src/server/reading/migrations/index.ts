import type Database from 'better-sqlite3';
import { migration001 } from './001_init';
import { migration002 } from './002_images';

// 迁移执行器（04 §5）：按版本号顺序执行未应用的迁移，每条迁移在独立事务中执行。
// 只允许向前兼容的增量变更，保证回滚发布目录时数据库仍可用（13 §5.2）。

export interface Migration {
  version: number;
  name: string;
  sql: string;
}

export const MIGRATIONS: readonly Migration[] = [migration001, migration002];

export function runMigrations(
  db: Database.Database,
  migrations: readonly Migration[] = MIGRATIONS,
): number[] {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version     INTEGER PRIMARY KEY,
    applied_at  INTEGER NOT NULL
  )`);
  const applied = new Set(
    (db.prepare('SELECT version FROM schema_migrations').all() as { version: number }[]).map(
      (r) => r.version,
    ),
  );
  const record = db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)');
  const done: number[] = [];
  for (const m of [...migrations].sort((a, b) => a.version - b.version)) {
    if (applied.has(m.version)) continue;
    db.transaction(() => {
      db.exec(m.sql);
      record.run(m.version, Date.now());
    })();
    done.push(m.version);
  }
  return done;
}
