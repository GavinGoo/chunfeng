// 图片提问（15 §4、§17）：前后端共用的标识、尺寸常量与缩放函数

/** 上传图片的 id：nanoid(16)，字母数字（约 95 bit）。不对外公开，仍取不可枚举的长度 */
export const IMAGE_ID_RE = /^[0-9A-Za-z]{16}$/;

export function isImageId(v: unknown): v is string {
  return typeof v === 'string' && IMAGE_ID_RE.test(v);
}

/** 上传请求体上限 */
export const UPLOAD_MAX_BYTES = 8 * 1024 * 1024;
/** 保存、发给 LLM 与放大查看所用的规格：长边与总像素（≈ 1300²，与 DeepSeek 的缩放当量相当） */
export const FULL_MAX_EDGE = 2048;
export const FULL_MAX_PIXELS = 1_700_000;
/** 答案页上的相片 */
export const THUMB_MAX_EDGE = 480;

export interface UploadImageResponse {
  imageId: string;
  width: number; // full 规格的尺寸
  height: number;
}

/** 同时满足长边与总像素两个上限，结果取整且不放大 */
export function fitWithin(
  w: number,
  h: number,
  lim: { maxEdge: number; maxPixels: number },
): { width: number; height: number } {
  if (!(w > 0) || !(h > 0)) return { width: 0, height: 0 };
  const scale = Math.min(1, lim.maxEdge / Math.max(w, h), Math.sqrt(lim.maxPixels / (w * h)));
  if (scale >= 1) return { width: Math.round(w), height: Math.round(h) };
  // 向下取整保证不超限，且至少 1 px
  return { width: Math.max(1, Math.floor(w * scale)), height: Math.max(1, Math.floor(h * scale)) };
}
