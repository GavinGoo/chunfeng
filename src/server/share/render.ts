import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ImageResponse } from 'next/og';
import { createElement } from 'react';
import type { Reading } from '@/lib/shared/types';
import { Semaphore } from '../http/semaphore';
import { readImage } from '../image/store';
import { log } from '../log';
import { getRepository } from '../reading/repository';
import { type SatoriFont, subsetFor, titleFont } from './fonts';
import { withShareMetadata } from './metadata';
import { qrDataUri } from './qrcode';
import {
  photoLayoutFor,
  photoMax,
  SHARE_HEIGHT,
  SHARE_WIDTH,
  type SharePhoto,
  ShareTemplate,
  shareTexts,
  toShareModel,
} from './template';

// 分享图渲染编排（12 §3.1 第 3 步）：
// 汇总文字 → 字体子集 → 二维码 → next/og ImageResponse（satori → SVG → PNG）→ 写入隐式标识。
// 全局并发上限 2，其余排队（排队超过 RENDER_QUEUE_TIMEOUT_MS → 503 BUSY）。

export const RENDER_CONCURRENCY = 2;
export const RENDER_QUEUE_TIMEOUT_MS = 20_000;

const g = globalThis as typeof globalThis & {
  __chunfengShareGate?: Semaphore;
  __chunfengPaper?: string;
};

function gate(): Semaphore {
  g.__chunfengShareGate ??= new Semaphore(RENDER_CONCURRENCY);
  return g.__chunfengShareGate;
}

/** 纸纹背景（与答案页 paper.webp 同源），JPEG data URI，常驻内存 */
function paperDataUri(): string {
  g.__chunfengPaper ??= `data:image/jpeg;base64,${readFileSync(
    path.join(process.cwd(), 'assets/share/paper.jpg'),
  ).toString('base64')}`;
  return g.__chunfengPaper;
}

export interface RenderOptions {
  /** 二维码指向的站点地址（`协议://域名`），取自请求（12 §3.1） */
  baseUrl: string;
}

export function shareUrl(baseUrl: string, id: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/a/${id}`;
}

/**
 * 带图答案的相片（15 §12）：按宽高比选定版式，full 文件经 sharp 缩放到该版式相片框的像素尺寸（不放大），
 * 以 JPEG data URI 交给 satori。
 * 读图失败时返回 fallback（按无图版式渲染并标注），不报错。
 */
export async function loadSharePhoto(reading: Reading): Promise<{ photo?: SharePhoto; fallback?: boolean }> {
  if (!reading.image) return {};
  try {
    const ref = getRepository().getImageForReading(reading.id);
    const full = ref ? await readImage(ref.imageId, 'full') : null;
    if (!full) return { fallback: true };
    const sharp = (await import('sharp')).default;
    const meta = await sharp(full).metadata();
    const layout = photoLayoutFor(meta.width ?? 0, meta.height ?? 0);
    const { data, info } = await sharp(full)
      .resize({ ...photoMax(layout), fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 85, mozjpeg: true })
      .toBuffer({ resolveWithObject: true });
    return {
      photo: {
        dataUri: `data:image/jpeg;base64,${data.toString('base64')}`,
        width: info.width,
        height: info.height,
        layout,
      },
    };
  } catch (e) {
    log().warn({
      evt: 'share.photo_failed',
      id: reading.id,
      err: e instanceof Error ? e.message : String(e),
    });
    return { fallback: true };
  }
}

/** 不排队、不写元数据的纯渲染（测试与调试用） */
export async function renderSharePng(reading: Reading, baseUrl: string): Promise<Buffer> {
  const model = toShareModel(reading, await loadSharePhoto(reading));
  const texts = shareTexts(model);
  const fonts: SatoriFont[] = (
    await Promise.all([subsetFor(texts[400], 400), subsetFor(texts[600], 600)])
  ).flat();
  fonts.push(titleFont());
  const element = createElement(ShareTemplate, {
    model,
    assets: { paperDataUri: paperDataUri(), qrDataUri: qrDataUri(shareUrl(baseUrl, reading.id)) },
  });
  const res = new ImageResponse(element, { width: SHARE_WIDTH, height: SHARE_HEIGHT, fonts });
  return Buffer.from(await res.arrayBuffer());
}

/** 渲染一张分享图（含隐式标识），受全局并发上限约束 */
export async function renderShareImage(reading: Reading, opts: RenderOptions): Promise<Buffer> {
  const release = await gate().acquire(RENDER_QUEUE_TIMEOUT_MS);
  try {
    const png = await renderSharePng(reading, opts.baseUrl);
    return withShareMetadata(png, { readingId: reading.id });
  } finally {
    release();
  }
}
