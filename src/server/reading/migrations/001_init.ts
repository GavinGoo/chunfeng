// 初始表结构（04 §5）。迁移以 TS 字符串模块保存，而不是 .sql 文件，
// 以便随 standalone 构建一起打包（无需额外的文件追踪配置）。

export const migration001 = {
  version: 1,
  name: 'init',
  sql: `
CREATE TABLE IF NOT EXISTS readings (
  id            TEXT PRIMARY KEY,
  request_id    TEXT NOT NULL UNIQUE,
  question      TEXT NOT NULL,
  options_json  TEXT NOT NULL,
  llm_json      TEXT NOT NULL,
  scoring_json  TEXT NOT NULL,
  jev_model     TEXT NOT NULL,
  tz            TEXT NOT NULL,
  page_no       INTEGER NOT NULL,
  regen_of      TEXT REFERENCES readings(id) ON DELETE SET NULL,
  ip_hash       TEXT,
  created_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_readings_created_at ON readings(created_at);
`,
} as const;
