import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { IMAGE_ID_RE } from '@/lib/shared/image';
import { getConfig } from '../config';
import type { ProcessedImage } from './process';

// 图片文件（15 §6.2）：${IMAGE_DIR}/{id 前两位}/{id}.jpg 与 {id}.t.jpg。
// 路径只由校验过的 id 拼成，杜绝路径穿越；写入后不再修改。

export type ImageSize = 'full' | 'thumb';

export function imagePath(id: string, size: ImageSize, dir: string = getConfig().imageDir): string {
  if (!IMAGE_ID_RE.test(id)) throw new Error('invalid image id');
  return join(dir, id.slice(0, 2), size === 'full' ? `${id}.jpg` : `${id}.t.jpg`);
}

async function writeAtomic(path: string, data: Buffer): Promise<void> {
  const tmp = `${path}.${process.pid}.${Date.now().toString(36)}.tmp`;
  await writeFile(tmp, data, { mode: 0o640 });
  try {
    await rename(tmp, path);
  } catch (e) {
    await unlink(tmp).catch(() => {});
    throw e;
  }
}

export async function writeImage(id: string, img: ProcessedImage, dir?: string): Promise<void> {
  const full = imagePath(id, 'full', dir);
  const thumb = imagePath(id, 'thumb', dir);
  await mkdir(join(full, '..'), { recursive: true });
  try {
    await writeAtomic(full, img.full);
    await writeAtomic(thumb, img.thumb);
  } catch (e) {
    await removeImage(id, dir);
    throw e;
  }
}

/** 文件不存在或 id 非法时返回 null */
export async function readImage(id: string, size: ImageSize, dir?: string): Promise<Buffer | null> {
  if (!IMAGE_ID_RE.test(id)) return null;
  try {
    return await readFile(imagePath(id, size, dir));
  } catch {
    return null;
  }
}

export async function removeImage(id: string, dir?: string): Promise<void> {
  if (!IMAGE_ID_RE.test(id)) return;
  for (const size of ['full', 'thumb'] as const) {
    await unlink(imagePath(id, size, dir)).catch(() => {});
  }
}
