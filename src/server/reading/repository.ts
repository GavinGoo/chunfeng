import type Database from 'better-sqlite3';
import { pageNoFromId } from '@/lib/shared/ids';
import type { Reading, ReadingImage, ReadingOption } from '@/lib/shared/types';
import { getDb } from './db';

// 答案持久化（04 §5）：只暴露领域方法，一律使用预编译语句与参数绑定。

/** llm_json：LLM 侧的原始数据（不下发给前端） */
export interface StoredLlm {
  model: string;
  promptVersion: string;
  questionEn: string;
  briefsEn: string[]; // 按 LLM 原始顺序 o1–o4
  usage?: { promptTokens: number; completionTokens: number; cacheHitTokens?: number };
  attempts: number;
  semanticAttempts: number;
  repaired: boolean;
  /** 带图提问（15 §7.2）；无图时不写这些字段，文字提问的 llm_json 不变 */
  hasImage?: boolean;
  imageEn?: string;
  visionPromptVersion?: string;
}

/** scoring_json：评分策略、参数与 JEV 原始答案 */
export interface StoredScoring {
  strategy: string;
  version: string;
  params: { strategy: string; blendWeight: number; softmaxTau: number };
  choice: number[]; // c_k，按 o1–o4
  fit: number[]; // s_k，按 o1–o4
  probs: number[]; // p_k，按 o1–o4
  order: number[]; // A–D 对应的 LLM 原始下标（0–3）
  confidence: number;
  positionAgreement: boolean;
  raw: unknown;
}

export interface NewReading {
  id: string;
  requestId: string;
  question: string;
  options: ReadingOption[];
  llm: StoredLlm;
  scoring: StoredScoring;
  jevModel: string;
  tz: string;
  pageNo: number;
  regenOf?: string;
  ipHash?: string;
  createdAt: number; // Unix ms
  imageId?: string;
  imageAlt?: string;
}

/** images 表的一行（15 §6.1） */
export interface NewImage {
  id: string;
  sha256: string;
  width: number;
  height: number;
  bytes: number;
  thumbWidth: number;
  thumbHeight: number;
  sourceFormat: string;
  ipHash?: string;
  createdAt: number;
}

export interface StoredImageRef {
  imageId: string;
  sha256: string;
}

interface Row {
  id: string;
  request_id: string;
  question: string;
  options_json: string;
  tz: string;
  page_no: number;
  regen_of: string | null;
  created_at: number;
  image_id: string | null;
  image_alt: string | null;
  image_width: number | null;
  image_height: number | null;
}

// LEFT JOIN images：没有图片（或图片行已不存在）时不输出 image 字段，老数据与文字提问的响应不变
const PUBLIC_SELECT = `SELECT r.id, r.request_id, r.question, r.options_json, r.tz, r.page_no, r.regen_of,
  r.created_at, r.image_id, r.image_alt, i.width AS image_width, i.height AS image_height
  FROM readings r LEFT JOIN images i ON i.id = r.image_id`;

function toReading(row: Row): Reading {
  const reading: Reading = {
    id: row.id,
    question: row.question,
    createdAt: new Date(row.created_at).toISOString(),
    tz: row.tz,
    options: JSON.parse(row.options_json) as ReadingOption[],
    pageNo: row.page_no ?? pageNoFromId(row.id),
  };
  if (row.regen_of) reading.regenOf = row.regen_of;
  if (row.image_id && row.image_width && row.image_height) {
    const image: ReadingImage = {
      width: row.image_width,
      height: row.image_height,
      alt: row.image_alt ?? '',
    };
    reading.image = image;
  }
  return reading;
}

function isUniqueRequestIdViolation(e: unknown): boolean {
  return (
    e instanceof Error &&
    (e as { code?: string }).code === 'SQLITE_CONSTRAINT_UNIQUE' &&
    e.message.includes('readings.request_id')
  );
}

export class ReadingRepository {
  private readonly stmts;

  constructor(private readonly db: Database.Database) {
    this.stmts = {
      insert: db.prepare(
        `INSERT INTO readings (id, request_id, question, options_json, llm_json, scoring_json, jev_model, tz,
           page_no, regen_of, ip_hash, created_at, image_id, image_alt)
         VALUES (@id, @requestId, @question, @optionsJson, @llmJson, @scoringJson, @jevModel, @tz,
           @pageNo, @regenOf, @ipHash, @createdAt, @imageId, @imageAlt)`,
      ),
      byId: db.prepare(`${PUBLIC_SELECT} WHERE r.id = ?`),
      byRequestId: db.prepare(`${PUBLIC_SELECT} WHERE r.request_id = ?`),
      insertImage: db.prepare(
        `INSERT INTO images (id, sha256, width, height, bytes, thumb_width, thumb_height, source_format,
           ip_hash, created_at)
         VALUES (@id, @sha256, @width, @height, @bytes, @thumbWidth, @thumbHeight, @sourceFormat,
           @ipHash, @createdAt)`,
      ),
      imageExists: db.prepare('SELECT 1 AS ok FROM images WHERE id = ?'),
      readingImageId: db.prepare('SELECT image_id FROM readings WHERE id = ?'),
      imageForReading: db.prepare(
        `SELECT i.id AS image_id, i.sha256 FROM readings r JOIN images i ON i.id = r.image_id WHERE r.id = ?`,
      ),
      orphanIds: db.prepare(
        `SELECT id FROM images WHERE created_at < ?
           AND NOT EXISTS (SELECT 1 FROM readings r WHERE r.image_id = images.id)`,
      ),
      deleteImage: db.prepare(
        'DELETE FROM images WHERE id = ? AND NOT EXISTS (SELECT 1 FROM readings r WHERE r.image_id = images.id)',
      ),

      titles: db.prepare('SELECT options_json FROM readings WHERE id = ?'),
      expiredIds: db.prepare('SELECT id FROM readings WHERE created_at < ?'),
      deleteOlder: db.prepare('DELETE FROM readings WHERE created_at < ?'),
      ping: db.prepare('SELECT 1 AS ok'),
    };
  }

  /**
   * 写入一条答案。request_id 唯一约束兜底并发重复：冲突时返回已存在的记录。
   */
  insert(r: NewReading): { inserted: true; reading: Reading } | { inserted: false; reading: Reading } {
    try {
      this.stmts.insert.run({
        id: r.id,
        requestId: r.requestId,
        question: r.question,
        optionsJson: JSON.stringify(r.options),
        llmJson: JSON.stringify(r.llm),
        scoringJson: JSON.stringify(r.scoring),
        jevModel: r.jevModel,
        tz: r.tz,
        pageNo: r.pageNo,
        regenOf: r.regenOf ?? null,
        ipHash: r.ipHash ?? null,
        createdAt: r.createdAt,
        imageId: r.imageId ?? null,
        imageAlt: r.imageId ? (r.imageAlt ?? '') : null,
      });
    } catch (e) {
      if (isUniqueRequestIdViolation(e)) {
        const existing = this.getByRequestId(r.requestId);
        if (existing) return { inserted: false, reading: existing.reading };
      }
      throw e;
    }
    const saved = this.getPublicReading(r.id);
    if (!saved) throw new Error('reading vanished after insert');
    return { inserted: true, reading: saved };
  }

  getPublicReading(id: string): Reading | null {
    const row = this.stmts.byId.get(id) as Row | undefined;
    return row ? toReading(row) : null;
  }

  getByRequestId(requestId: string): { question: string; imageId: string | null; reading: Reading } | null {
    const row = this.stmts.byRequestId.get(requestId) as Row | undefined;
    return row ? { question: row.question, imageId: row.image_id, reading: toReading(row) } : null;
  }

  insertImage(img: NewImage): void {
    this.stmts.insertImage.run({ ...img, ipHash: img.ipHash ?? null });
  }

  imageExists(id: string): boolean {
    return (this.stmts.imageExists.get(id) as { ok: number } | undefined)?.ok === 1;
  }

  /** 「再翻一次」沿用图片用：答案引用的 image_id（答案不存在或无图 → null） */
  getReadingImageId(readingId: string): string | null {
    const row = this.stmts.readingImageId.get(readingId) as { image_id: string | null } | undefined;
    return row?.image_id ?? null;
  }

  /** 读图接口用：带图答案的图片 id 与哈希 */
  getImageForReading(readingId: string): StoredImageRef | null {
    const row = this.stmts.imageForReading.get(readingId) as { image_id: string; sha256: string } | undefined;
    return row ? { imageId: row.image_id, sha256: row.sha256 } : null;
  }

  /** 早于 ts 且没有任何答案引用的图片 id（15 §6.3） */
  listOrphanImageIds(ts: number): string[] {
    return (this.stmts.orphanIds.all(ts) as { id: string }[]).map((r) => r.id);
  }

  /** 删除一张图片的行；仍被引用时不删，返回是否删除 */
  deleteImageRow(id: string): boolean {
    return this.stmts.deleteImage.run(id).changes > 0;
  }

  /** 「再翻一次」用：上一条的 4 个标题；不存在返回 null */
  getTitles(id: string): string[] | null {
    const row = this.stmts.titles.get(id) as { options_json: string } | undefined;
    if (!row) return null;
    return (JSON.parse(row.options_json) as ReadingOption[]).map((o) => o.title);
  }

  /** 删除早于 ts 的记录，返回被删除的 id（用于清理分享图缓存） */
  deleteOlderThan(ts: number): string[] {
    return this.db.transaction(() => {
      const ids = (this.stmts.expiredIds.all(ts) as { id: string }[]).map((r) => r.id);
      if (ids.length > 0) this.stmts.deleteOlder.run(ts);
      return ids;
    })();
  }

  ping(): boolean {
    return (this.stmts.ping.get() as { ok: number } | undefined)?.ok === 1;
  }
}

const cache = new WeakMap<Database.Database, ReadingRepository>();

export function getRepository(): ReadingRepository {
  const db = getDb();
  let repo = cache.get(db);
  if (!repo) {
    repo = new ReadingRepository(db);
    cache.set(db, repo);
  }
  return repo;
}
