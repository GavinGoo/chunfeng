// 仅服务端使用的图片常量（15 §4）

/** 解码前按头信息拒绝，防止解压炸弹 */
export const INPUT_MAX_PIXELS = 40_000_000;
/** 更小的图没有意义 */
export const INPUT_MIN_EDGE = 16;
export const FULL_JPEG_QUALITY = 85;
export const THUMB_JPEG_QUALITY = 80;
/** 单张图片的处理超时 */
export const PROCESS_TIMEOUT_SEC = 10;
/** 未被任何答案引用的图片的保留时长 */
export const ORPHAN_TTL_MS = 24 * 60 * 60 * 1000;
/** 同时处理的上传数（重编码很耗 CPU） */
export const UPLOAD_CONCURRENCY = 2;
/** 上传排队上限，超过 → BUSY */
export const UPLOAD_QUEUE_TIMEOUT_MS = 10_000;
