import { customAlphabet } from 'nanoid';
import type { UploadImageResponse } from '@/lib/shared/image';
import { AppError } from '../http/errors';
import { log } from '../log';
import { getRepository } from '../reading/repository';
import { serverState } from '../reading/state';
import { UPLOAD_QUEUE_TIMEOUT_MS } from './limits';
import { sniffImage } from './sniff';
import { removeImage, writeImage } from './store';

// 上传的处理（15 §5.2 第 5–10 步）。路由已完成开关、Origin、限流与限长读取。

/** imageId：nanoid(16)，字母数字（约 95 bit），与 IMAGE_ID_RE 一致 */
export const newImageId = customAlphabet(
  '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz',
  16,
);

export async function storeUpload(bytes: Buffer, ipHash: string): Promise<UploadImageResponse> {
  const started = Date.now();
  // 5. 魔数白名单
  const format = sniffImage(bytes);
  if (!format) {
    log().info({ evt: 'image.rejected', reason: 'format', bytes: bytes.length, ipHash });
    throw new AppError('UNSUPPORTED_MEDIA', 'unsupported image format');
  }
  // 6. 并发闸门
  const release = await serverState().uploadSemaphore.acquire(UPLOAD_QUEUE_TIMEOUT_MS);
  try {
    // 7–8. 头信息检查与重编码（sharp 按需加载，未开启图片功能的进程不加载原生库）
    const { processImage } = await import('./process');
    let img: Awaited<ReturnType<typeof processImage>>;
    try {
      img = await processImage(bytes, format);
    } catch (e) {
      if (e instanceof AppError) log().info({ evt: 'image.rejected', reason: 'unreadable', format, ipHash });
      throw e;
    }
    // 9. 先写文件再插行；插行失败则删除刚写的文件
    const id = newImageId();
    await writeImage(id, img);
    try {
      getRepository().insertImage({
        id,
        sha256: img.sha256,
        width: img.width,
        height: img.height,
        bytes: img.full.length,
        thumbWidth: img.thumbWidth,
        thumbHeight: img.thumbHeight,
        sourceFormat: img.sourceFormat,
        ipHash,
        createdAt: Date.now(),
      });
    } catch (e) {
      await removeImage(id);
      throw e;
    }
    // 10. 日志：不含图片内容
    log().info({
      evt: 'image.uploaded',
      imageId: id,
      format,
      inBytes: bytes.length,
      outBytes: img.full.length,
      width: img.width,
      height: img.height,
      ms: Date.now() - started,
      ipHash,
    });
    return { imageId: id, width: img.width, height: img.height };
  } finally {
    release();
  }
}
