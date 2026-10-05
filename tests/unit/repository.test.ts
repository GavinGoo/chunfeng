import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { ReadingOption } from '@/lib/shared/types';
import { openDatabase } from '@/server/reading/db';
import { removeShareCache } from '@/server/reading/maintenance';
import { MIGRATIONS, runMigrations } from '@/server/reading/migrations';
import { type NewReading, ReadingRepository } from '@/server/reading/repository';

const dir = mkdtempSync(join(tmpdir(), 'chunfeng-repo-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const options: ReadingOption[] = (['A', 'B', 'C', 'D'] as const).map((letter, i) => ({
  letter,
  title: `标题${i}`,
  desc: `说明${i}`,
  prob: [0.4, 0.3, 0.2, 0.1][i]!,
  pct: [40, 30, 20, 10][i]!,
}));

function record(
  id: string,
  requestId: string,
  createdAt = 1_000,
  extra: Partial<NewReading> = {},
): NewReading {
  return {
    id,
    requestId,
    question: '要不要换工作？',
    options,
    llm: {
      model: 'm',
      promptVersion: 'options-v1',
      questionEn: 'q',
      briefsEn: ['a', 'b', 'c', 'd'],
      attempts: 1,
      semanticAttempts: 1,
      repaired: false,
    },
    scoring: {
      strategy: 'blend',
      version: 'blend-v1',
      params: { strategy: 'blend', blendWeight: 0.6, softmaxTau: 0.25 },
      choice: [0.25, 0.25, 0.25, 0.25],
      fit: [0.5, 0.5, 0.5, 0.5],
      probs: [0.4, 0.3, 0.2, 0.1],
      order: [0, 1, 2, 3],
      confidence: 0.5,
      positionAgreement: true,
      raw: {},
    },
    jevModel: 'jev-1.13-free',
    tz: 'Asia/Shanghai',
    pageNo: 237,
    ipHash: 'h',
    createdAt,
    ...extra,
  };
}

let db: Database.Database;
let repo: ReadingRepository;
let n = 0;
beforeEach(() => {
  db = openDatabase(join(dir, `t${n++}.db`));
  repo = new ReadingRepository(db);
});

describe('migrations', () => {
  it('WAL 与 pragma；迁移只执行一次并记录版本', () => {
    expect(db.pragma('journal_mode', { simple: true })).toBe('wal');
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(db.pragma('busy_timeout', { simple: true })).toBe(5000);
    expect(runMigrations(db)).toEqual([]);
    const versions = db.prepare('SELECT version FROM schema_migrations').all();
    expect(versions).toEqual(MIGRATIONS.map((m) => ({ version: m.version })));
  });

  it('迁移失败时整体回滚', () => {
    const bad = [{ version: 99, name: 'bad', sql: 'CREATE TABLE t99 (x INTEGER); SELECT * FROM nope;' }];
    expect(() => runMigrations(db, bad)).toThrow();
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 't99'").get()).toBeUndefined();
    expect(db.prepare('SELECT 1 FROM schema_migrations WHERE version = 99').get()).toBeUndefined();
  });

  it('自动创建父目录', () => {
    const nested = openDatabase(join(dir, 'a', 'b', 'c.db'));
    expect(new ReadingRepository(nested).ping()).toBe(true);
    nested.close();
  });
});

describe('ReadingRepository', () => {
  it('insert → getPublicReading / getByRequestId / getTitles', () => {
    const r = repo.insert(record('AAAAAAAAAAAA', 'req-1', Date.UTC(2026, 8, 27, 13, 40, 12, 345)));
    expect(r.inserted).toBe(true);
    const got = repo.getPublicReading('AAAAAAAAAAAA');
    expect(got).toEqual({
      id: 'AAAAAAAAAAAA',
      question: '要不要换工作？',
      createdAt: '2026-09-27T13:40:12.345Z',
      tz: 'Asia/Shanghai',
      options,
      pageNo: 237,
    });
    // 内部数据不下发
    expect(JSON.stringify(got)).not.toContain('briefsEn');
    expect(repo.getByRequestId('req-1')?.reading.id).toBe('AAAAAAAAAAAA');
    expect(repo.getTitles('AAAAAAAAAAAA')).toEqual(['标题0', '标题1', '标题2', '标题3']);
    expect(repo.getPublicReading('nope')).toBeNull();
    expect(repo.getTitles('nope')).toBeNull();
  });

  it('request_id 唯一约束兜底：返回已存在的记录', () => {
    repo.insert(record('AAAAAAAAAAAA', 'req-1'));
    const dup = repo.insert(record('BBBBBBBBBBBB', 'req-1'));
    expect(dup).toMatchObject({ inserted: false, reading: { id: 'AAAAAAAAAAAA' } });
  });

  it('regenOf 外键；删除上一条后置空', () => {
    repo.insert(record('AAAAAAAAAAAA', 'req-1', 1_000));
    repo.insert(record('BBBBBBBBBBBB', 'req-2', 5_000, { regenOf: 'AAAAAAAAAAAA' }));
    expect(repo.getPublicReading('BBBBBBBBBBBB')?.regenOf).toBe('AAAAAAAAAAAA');
    expect(() => repo.insert(record('CCCCCCCCCCCC', 'req-3', 5_000, { regenOf: 'ZZZZZZZZZZZZ' }))).toThrow();
    expect(repo.deleteOlderThan(2_000)).toEqual(['AAAAAAAAAAAA']);
    expect(repo.getPublicReading('AAAAAAAAAAAA')).toBeNull();
    expect(repo.getPublicReading('BBBBBBBBBBBB')?.regenOf).toBeUndefined();
    expect(repo.deleteOlderThan(2_000)).toEqual([]);
  });

  it('删除分享图缓存 {id}.png（含历史的版本 / 域名文件名）', async () => {
    const cache = join(dir, 'share-cache');
    rmSync(cache, { recursive: true, force: true });
    await import('node:fs').then((fs) => fs.mkdirSync(cache, { recursive: true }));
    for (const f of [
      'AAAAAAAAAAAA.png',
      'AAAAAAAAAAAA-v2.png', // 有版本、无域名分键的历史文件
      'AAAAAAAAAAAA-v2-1a2b3c4d.png', // 有域名分键的历史文件
      'AAAAAAAAAAAA-v2-1a2b3c4d.png.tmp',
      'BBBBBBBBBBBB.png',
      'notes.txt',
    ]) {
      writeFileSync(join(cache, f), '');
    }
    expect(await removeShareCache(cache, ['AAAAAAAAAAAA'])).toBe(3);
    expect(readdirSync(cache).sort()).toEqual([
      'AAAAAAAAAAAA-v2-1a2b3c4d.png.tmp',
      'BBBBBBBBBBBB.png',
      'notes.txt',
    ]);
    expect(await removeShareCache(join(dir, 'missing'), ['AAAAAAAAAAAA'])).toBe(0);
  });

  const img = (id: string, createdAt = 1_000) => ({
    id,
    sha256: 'f'.repeat(64),
    width: 1536,
    height: 1152,
    bytes: 300_000,
    thumbWidth: 480,
    thumbHeight: 360,
    sourceFormat: 'jpeg',
    ipHash: 'h',
    createdAt,
  });

  it('图片：插入与查询；LEFT JOIN 后输出 image（15 §6、§7.3）', () => {
    repo.insertImage(img('Img0000000000001'));
    expect(repo.imageExists('Img0000000000001')).toBe(true);
    expect(repo.imageExists('Img0000000000009')).toBe(false);
    repo.insert(
      record('AAAAAAAAAAAA', 'req-1', 1_000, { imageId: 'Img0000000000001', imageAlt: '两件外套' }),
    );
    repo.insert(record('BBBBBBBBBBBB', 'req-2'));
    expect(repo.getPublicReading('AAAAAAAAAAAA')?.image).toEqual({
      width: 1536,
      height: 1152,
      alt: '两件外套',
    });
    // 无图时不输出 image 字段
    expect('image' in (repo.getPublicReading('BBBBBBBBBBBB') ?? {})).toBe(false);
    expect(repo.getByRequestId('req-1')?.imageId).toBe('Img0000000000001');
    expect(repo.getByRequestId('req-2')?.imageId).toBeNull();
    expect(repo.getReadingImageId('AAAAAAAAAAAA')).toBe('Img0000000000001');
    expect(repo.getReadingImageId('BBBBBBBBBBBB')).toBeNull();
    expect(repo.getImageForReading('AAAAAAAAAAAA')).toEqual({
      imageId: 'Img0000000000001',
      sha256: 'f'.repeat(64),
    });
    expect(repo.getImageForReading('BBBBBBBBBBBB')).toBeNull();
    // 引用不存在的图片 → 外键失败
    expect(() =>
      repo.insert(record('CCCCCCCCCCCC', 'req-3', 1_000, { imageId: 'Img0000000000009' })),
    ).toThrow();
  });

  it('孤儿图片的筛选与删除：有引用的不删（15 §6.3）', () => {
    repo.insertImage(img('Img0000000000001', 1_000)); // 被引用
    repo.insertImage(img('Img0000000000002', 1_000)); // 孤儿、已过期
    repo.insertImage(img('Img0000000000003', 9_000)); // 孤儿、未过期
    repo.insert(record('AAAAAAAAAAAA', 'req-1', 1_000, { imageId: 'Img0000000000001' }));
    expect(repo.listOrphanImageIds(5_000)).toEqual(['Img0000000000002']);
    expect(repo.deleteImageRow('Img0000000000001')).toBe(false);
    expect(repo.deleteImageRow('Img0000000000002')).toBe(true);
    expect(repo.imageExists('Img0000000000002')).toBe(false);
    // 答案被删除后，其图片成为孤儿
    repo.deleteOlderThan(2_000);
    expect(repo.listOrphanImageIds(5_000)).toEqual(['Img0000000000001']);
  });
});
