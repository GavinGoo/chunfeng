// 浏览器端预处理（15 §10.5）：解码 → 按 EXIF 摆正 → 缩到长边 ≤ 2048 px、≤ 1.7 MP → 重编码为 JPEG。
// 只为减小上传体积；安全与规格由服务端保证，服务端不信任这一步的结果。

import { FULL_MAX_EDGE, FULL_MAX_PIXELS, fitWithin, UPLOAD_MAX_BYTES } from '@/lib/shared/image';

export const CLIENT_MAX_INPUT_BYTES = 30 * 1024 * 1024;
const JPEG_QUALITY = 0.9;
const DRAFT_THUMB_EDGE = 160;
const DRAFT_THUMB_QUALITY = 0.7;
const DRAFT_THUMB_MAX_CHARS = 16 * 1024 * 1.4; // ≈ 16 KB 的 base64

/** 服务端能解码的格式：浏览器解不了时可以原样上传，交给服务端判断 */
const RAW_UPLOADABLE = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']);

export type PrepareImageResult =
  | { ok: true; blob: Blob; width: number; height: number; previewUrl?: string; draftThumb?: string }
  | { ok: false; reason: 'unsupported' | 'tooLarge' };

interface Decoded {
  source: CanvasImageSource;
  width: number;
  height: number;
  close(): void;
}

async function decode(file: Blob): Promise<Decoded | null> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
      return { source: bmp, width: bmp.width, height: bmp.height, close: () => bmp.close() };
    } catch {
      // 回退到 <img>
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    // <img> 默认按 EXIF 方向显示（image-orientation: from-image）
    return {
      source: img,
      width: img.naturalWidth,
      height: img.naturalHeight,
      close: () => URL.revokeObjectURL(url),
    };
  } catch {
    URL.revokeObjectURL(url);
    return null;
  }
}

function toBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/jpeg', quality));
}

function draw(d: Decoded, width: number, height: number): HTMLCanvasElement | null {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  // 透明底铺白（与服务端一致）
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(d.source, 0, 0, width, height);
  return canvas;
}

export async function prepareImage(file: File): Promise<PrepareImageResult> {
  if (file.type && !file.type.startsWith('image/')) return { ok: false, reason: 'unsupported' };
  if (file.size > CLIENT_MAX_INPUT_BYTES) return { ok: false, reason: 'tooLarge' };

  const decoded = await decode(file);
  if (!decoded?.width || !decoded.height) {
    decoded?.close();
    // 解不了：服务端支持的格式且不超过上传上限 → 原样上传，没有本地预览
    if (RAW_UPLOADABLE.has(file.type) && file.size <= UPLOAD_MAX_BYTES) {
      return { ok: true, blob: file, width: 0, height: 0 };
    }
    return { ok: false, reason: file.size > UPLOAD_MAX_BYTES ? 'tooLarge' : 'unsupported' };
  }
  try {
    const target = fitWithin(decoded.width, decoded.height, {
      maxEdge: FULL_MAX_EDGE,
      maxPixels: FULL_MAX_PIXELS,
    });
    const canvas = draw(decoded, target.width, target.height);
    const blob = canvas ? await toBlob(canvas, JPEG_QUALITY) : null;
    if (!blob) {
      if (RAW_UPLOADABLE.has(file.type) && file.size <= UPLOAD_MAX_BYTES)
        return { ok: true, blob: file, width: 0, height: 0 };
      return { ok: false, reason: 'unsupported' };
    }
    if (blob.size > UPLOAD_MAX_BYTES) return { ok: false, reason: 'tooLarge' };
    const small = fitWithin(target.width, target.height, {
      maxEdge: DRAFT_THUMB_EDGE,
      maxPixels: DRAFT_THUMB_EDGE * DRAFT_THUMB_EDGE,
    });
    const thumbCanvas = draw(decoded, small.width, small.height);
    let draftThumb = thumbCanvas?.toDataURL('image/jpeg', DRAFT_THUMB_QUALITY);
    if (draftThumb && draftThumb.length > DRAFT_THUMB_MAX_CHARS) draftThumb = undefined;
    return {
      ok: true,
      blob,
      width: target.width,
      height: target.height,
      previewUrl: URL.createObjectURL(blob),
      draftThumb,
    };
  } finally {
    decoded.close();
  }
}
