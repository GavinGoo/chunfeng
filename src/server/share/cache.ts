import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

// 分享图磁盘缓存（12 §3.1 第 2、4 步）：`${dir}/${id}.png`。
// 一篇答案一张图（D35）：第一次请求渲染并落盘，此后模板、样式、域名怎么变都直接返回这个文件；
// 要换只能人工删掉它。文件名格式与 reading/maintenance.ts 的 TTL 清理保持一致。
// 先写临时文件再原子重命名，读者永远看不到半个文件。

export function cachePath(dir: string, id: string): string {
  return path.join(dir, `${id}.png`);
}

export async function cacheStat(file: string): Promise<{ size: number } | null> {
  try {
    const s = await stat(file);
    return s.isFile() ? { size: s.size } : null;
  } catch {
    return null;
  }
}

export async function readCache(file: string): Promise<Buffer | null> {
  try {
    return await readFile(file);
  } catch {
    return null;
  }
}

export async function writeCacheAtomic(file: string, data: Buffer): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  try {
    await writeFile(tmp, data);
    await rename(tmp, file);
  } catch (e) {
    await unlink(tmp).catch(() => undefined);
    throw e;
  }
}

/** ETag：同一篇答案的图片内容不变；带上字节数以防缓存文件被替换 */
export function etagFor(id: string, size: number): string {
  return `"${id}-${size.toString(36)}"`;
}

/** If-None-Match 是否命中（支持列表与 `*`，忽略弱校验前缀） */
export function ifNoneMatchHits(header: string | null, etag: string): boolean {
  if (!header) return false;
  return header
    .split(',')
    .map((s) => s.trim().replace(/^W\//, ''))
    .some((t) => t === '*' || t === etag);
}
