import { UPLOAD_MAX_BYTES } from '@/lib/shared/image';
import { getConfig } from '@/server/config';
import { readBytesLimited } from '@/server/http/body';
import { clientIp, hashIp } from '@/server/http/clientIp';
import { AppError, errorResponse, toAppError } from '@/server/http/errors';
import { isOriginAllowed } from '@/server/http/origin';
import { storeUpload } from '@/server/image/upload';
import { isVisionEnabled } from '@/server/image/vision';
import { log } from '@/server/log';
import { serverState } from '@/server/reading/state';

// POST /api/uploads（15 §5）：请求体为图片的原始字节。便宜的检查在前（15 §5.2）。
// 本接口只写不读：图片在被答案引用之前没有任何读取途径。

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request): Promise<Response> {
  try {
    // 1. 开关
    if (!isVisionEnabled()) throw new AppError('VISION_DISABLED', 'image upload is disabled');
    const cfg = getConfig();
    // 2. Origin
    if (!isOriginAllowed(req.headers)) {
      throw new AppError('FORBIDDEN_ORIGIN', 'cross-origin request rejected');
    }
    // 3. 上传限流（与提问分开计数）
    const ipHash = hashIp(clientIp(req.headers), cfg.ipHashSalt);
    const decision = serverState().uploadRateLimiter.take(ipHash);
    if (!decision.ok) {
      log().warn({ evt: 'ratelimit.hit', ipHash, scope: decision.scope, kind: 'upload' });
      throw new AppError('RATE_LIMITED', `upload rate limited (${decision.scope})`, {
        retryAfterMs: decision.retryAfterMs,
      });
    }
    // 4. 流式限长读取
    const bytes = await readBytesLimited(req, UPLOAD_MAX_BYTES).catch((e: unknown) => {
      if (e instanceof AppError) log().info({ evt: 'image.rejected', reason: 'size', ipHash });
      throw e;
    });
    // 5–10
    const data = await storeUpload(bytes, ipHash);
    return Response.json(data, { status: 201, headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    const err = toAppError(e);
    if (err.code === 'INTERNAL' && !(e instanceof AppError)) {
      log().error({ evt: 'api.uploads_failed', err: e instanceof Error ? e.message : String(e) });
    }
    return errorResponse(err);
  }
}
