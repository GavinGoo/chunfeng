import { AppError } from './errors';

// 请求体读取（04 §6）：≤ 4 KB，超出 → 413。按流读取，超限立即停止，不依赖 Content-Length 是否可信。

export const MAX_BODY_BYTES = 4096;

export async function readBodyLimited(req: Request, maxBytes: number = MAX_BODY_BYTES): Promise<string> {
  const bytes = await readBytesLimited(req, maxBytes);
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}

/** 字节版（图片上传，15 §5.2 第 4 步）：Content-Length 或实际读取超过上限 → 413 */
export async function readBytesLimited(req: Request, maxBytes: number): Promise<Buffer> {
  const declared = Number(req.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new AppError('PAYLOAD_TOO_LARGE', `body exceeds ${maxBytes} bytes`);
  }
  if (!req.body) return Buffer.alloc(0);
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new AppError('PAYLOAD_TOO_LARGE', `body exceeds ${maxBytes} bytes`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}
