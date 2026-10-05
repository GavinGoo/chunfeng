// 图片提问（15 §6.1）：新增 images 表与 readings 的两个可空列，属于向前兼容的增量变更。
// SQLite 允许 ADD COLUMN … REFERENCES，前提是默认值为 NULL。

export const migration002 = {
  version: 2,
  name: 'images',
  sql: `
CREATE TABLE IF NOT EXISTS images (
  id            TEXT PRIMARY KEY,
  sha256        TEXT NOT NULL,
  width         INTEGER NOT NULL,
  height        INTEGER NOT NULL,
  bytes         INTEGER NOT NULL,
  thumb_width   INTEGER NOT NULL,
  thumb_height  INTEGER NOT NULL,
  source_format TEXT NOT NULL,
  ip_hash       TEXT,
  created_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_images_created_at ON images(created_at);

ALTER TABLE readings ADD COLUMN image_id  TEXT REFERENCES images(id) ON DELETE SET NULL;
ALTER TABLE readings ADD COLUMN image_alt TEXT;
CREATE INDEX IF NOT EXISTS idx_readings_image_id ON readings(image_id);
`,
} as const;
