import { createHash } from 'node:crypto';
import sharp, { type Metadata } from 'sharp';
import { FULL_MAX_EDGE, FULL_MAX_PIXELS, fitWithin, THUMB_MAX_EDGE } from '@/lib/shared/image';
import { AppError } from '../http/errors';
import {
  FULL_JPEG_QUALITY,
  INPUT_MAX_PIXELS,
  INPUT_MIN_EDGE,
  PROCESS_TIMEOUT_SEC,
  THUMB_JPEG_QUALITY,
} from './limits';
import type { SniffedFormat } from './sniff';

// 重编码（15 §5.3）：摆正方向、去除全部元数据、限制尺寸、透明底铺白，统一输出 JPEG。
// 不调用 keepMetadata() / withMetadata()，输出不含 EXIF、GPS、XMP、ICC。

sharp.cache(false); // 长驻进程避免内存增长；并发由上传闸门控制

export interface ProcessedImage {
  full: Buffer;
  thumb: Buffer;
  width: number;
  height: number;
  thumbWidth: number;
  thumbHeight: number;
  sourceFormat: SniffedFormat;
  sha256: string;
}

const INPUT = { failOn: 'error', limitInputPixels: INPUT_MAX_PIXELS, animated: false } as const;

function unreadable(detail: string): AppError {
  return new AppError('IMAGE_UNREADABLE', `image unreadable: ${detail}`);
}

export async function processImage(input: Buffer, format: SniffedFormat): Promise<ProcessedImage> {
  let meta: Metadata;
  try {
    meta = await sharp(input, INPUT).metadata();
  } catch {
    throw unreadable('metadata');
  }
  // 已按 EXIF 方向换算的尺寸
  const w = meta.autoOrient?.width ?? meta.width;
  const h = meta.autoOrient?.height ?? meta.height;
  if (!w || !h) throw unreadable('no size');
  if (w * h > INPUT_MAX_PIXELS) throw unreadable('too many pixels');
  if (Math.min(w, h) < INPUT_MIN_EDGE) throw unreadable('too small');

  const target = fitWithin(w, h, { maxEdge: FULL_MAX_EDGE, maxPixels: FULL_MAX_PIXELS });
  try {
    const full = await sharp(input, INPUT)
      .timeout({ seconds: PROCESS_TIMEOUT_SEC })
      .autoOrient()
      // 精确缩放到 fitWithin 的结果（'inside' 会由取整后的短边反推长边，结果偏小）；形变不足 1 px
      .resize({ width: target.width, height: target.height, fit: 'fill' })
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: FULL_JPEG_QUALITY, mozjpeg: true })
      .toBuffer({ resolveWithObject: true });
    const thumb = await sharp(full.data)
      .timeout({ seconds: PROCESS_TIMEOUT_SEC })
      .resize({ width: THUMB_MAX_EDGE, height: THUMB_MAX_EDGE, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: THUMB_JPEG_QUALITY, mozjpeg: true })
      .toBuffer({ resolveWithObject: true });
    return {
      full: full.data,
      thumb: thumb.data,
      width: full.info.width,
      height: full.info.height,
      thumbWidth: thumb.info.width,
      thumbHeight: thumb.info.height,
      sourceFormat: format,
      sha256: createHash('sha256').update(full.data).digest('hex'),
    };
  } catch {
    throw unreadable('decode');
  }
}
