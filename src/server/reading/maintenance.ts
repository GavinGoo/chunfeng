import { readdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { getConfig } from '../config';
import { ORPHAN_TTL_MS } from '../image/limits';
import { removeImage } from '../image/store';
import { log } from '../log';
import { getRepository } from './repository';

// 定时清理，每小时一次，始终启动（15 §6.3）：
//  1. READING_TTL_DAYS > 0 时删除过期答案及其分享图缓存（04 §5）；
//  2. 删除孤儿图片：早于 24 h 且没有任何答案引用（过期答案的图片也在此一并清理）。

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
// 分享图缓存文件名：现在是 `{id}.png`（D35）；`-v{版本}` 与 `-v{版本}-{域名标记}` 是历史格式，
// 一并匹配，便于随 TTL 清理掉。
const SHARE_FILE_RE = /^([A-Za-z0-9_-]{12})(?:-v\d+(?:-[0-9a-f]{8})?)?\.png$/;

/** 删除某篇答案的分享图缓存（`{id}.png` 与历史文件名），返回删除的文件数 */
export async function removeShareCache(dir: string, ids: readonly string[]): Promise<number> {
  if (ids.length === 0) return 0;
  const wanted = new Set(ids);
  let files: string[];
  try {
    files = await readdir(dir);
  } catch {
    return 0; // 目录不存在
  }
  let removed = 0;
  for (const f of files) {
    const m = SHARE_FILE_RE.exec(f);
    if (m?.[1] && wanted.has(m[1])) {
      try {
        await unlink(join(dir, f));
        removed++;
      } catch {
        // 并发删除等情况，忽略
      }
    }
  }
  return removed;
}

export async function runTtlCleanup(now: number = Date.now()): Promise<{ readings: number; files: number }> {
  const cfg = getConfig();
  if (cfg.readingTtlDays <= 0) return { readings: 0, files: 0 };
  const ids = getRepository().deleteOlderThan(now - cfg.readingTtlDays * DAY_MS);
  const files = await removeShareCache(cfg.shareCacheDir, ids);
  if (ids.length > 0) log().info({ evt: 'reading.ttl_cleanup', readings: ids.length, files });
  return { readings: ids.length, files };
}

export async function runOrphanImageCleanup(now: number = Date.now()): Promise<number> {
  const repo = getRepository();
  const ids = repo.listOrphanImageIds(now - ORPHAN_TTL_MS);
  let removed = 0;
  for (const id of ids) {
    // 先删行（仍被引用时不删），再删文件；删行与筛选之间若被新答案引用，行会保留
    if (!repo.deleteImageRow(id)) continue;
    await removeImage(id);
    removed++;
  }
  if (removed > 0) log().info({ evt: 'image.orphan_cleanup', images: removed });
  return removed;
}

const g = globalThis as typeof globalThis & { __chunfengTtlTimer?: NodeJS.Timeout };

export function startTtlCleanup(): void {
  if (g.__chunfengTtlTimer) return;
  const tick = () => {
    runTtlCleanup()
      .catch((e: unknown) =>
        log().error({ evt: 'reading.ttl_cleanup_failed', err: e instanceof Error ? e.message : String(e) }),
      )
      .then(() => runOrphanImageCleanup())
      .catch((e: unknown) =>
        log().error({ evt: 'image.orphan_cleanup_failed', err: e instanceof Error ? e.message : String(e) }),
      );
  };
  tick();
  g.__chunfengTtlTimer = setInterval(tick, HOUR_MS);
  g.__chunfengTtlTimer.unref();
}
