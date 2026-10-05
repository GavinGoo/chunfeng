import { z } from 'zod';
import { DEFAULT_TZ, isValidTimeZone } from '@/lib/shared/datetime';
import { isReadingId } from '@/lib/shared/ids';
import { isImageId } from '@/lib/shared/image';
import { isQuestionLengthValid, normalizeQuestion } from '@/lib/shared/question';
import { getConfig } from '@/server/config';
import { readBodyLimited } from '@/server/http/body';
import { clientIp, hashIp } from '@/server/http/clientIp';
import { AppError, errorResponse, toAppError } from '@/server/http/errors';
import { isOriginAllowed } from '@/server/http/origin';
import { log } from '@/server/log';
import { createReading } from '@/server/reading/service';

// POST /api/readings（04 §2）

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const BodySchema = z.object({
  question: z.string().max(2000),
  requestId: z.string().regex(UUID_V4),
  tz: z.unknown().optional(),
  regenOf: z.unknown().optional(),
  imageId: z.unknown().optional(), // 带图提问（15 §7.1）
});

export async function POST(req: Request): Promise<Response> {
  const startedAt = Date.now();
  let requestId: string | undefined;
  try {
    const raw = await readBodyLimited(req);
    const cfg = getConfig();
    if (!isOriginAllowed(req.headers)) {
      throw new AppError('FORBIDDEN_ORIGIN', 'cross-origin request rejected');
    }

    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      throw new AppError('BAD_REQUEST', 'body must be JSON');
    }
    const parsed = BodySchema.safeParse(json);
    if (!parsed.success) throw new AppError('BAD_REQUEST', 'invalid body');
    requestId = parsed.data.requestId.toLowerCase();

    const question = normalizeQuestion(parsed.data.question);
    if (!isQuestionLengthValid(question)) throw new AppError('BAD_REQUEST', 'question length out of range');
    const tz = isValidTimeZone(parsed.data.tz) ? parsed.data.tz : DEFAULT_TZ;
    // regenOf 格式不对时直接忽略（与「不存在则忽略」一致）
    const regenOf = isReadingId(parsed.data.regenOf) ? parsed.data.regenOf : undefined;
    // imageId 格式不对 → 400（与 regenOf 不同：问题指向一张图，不能忽略）
    const rawImageId = parsed.data.imageId;
    if (rawImageId !== undefined && rawImageId !== null && !isImageId(rawImageId)) {
      throw new AppError('BAD_REQUEST', 'invalid imageId');
    }
    const imageId = isImageId(rawImageId) ? rawImageId : undefined;

    const result = await createReading({
      question,
      requestId,
      tz,
      regenOf,
      imageId,
      ipHash: hashIp(clientIp(req.headers), cfg.ipHashSalt),
      startedAt,
    });
    return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    const err = toAppError(e);
    if (err.code === 'INTERNAL' && !(e instanceof AppError)) {
      // 服务端日志可带错误信息；响应体绝不包含堆栈或上游原始报文
      log().error({ evt: 'api.readings_failed', requestId, err: e instanceof Error ? e.message : String(e) });
    }
    return errorResponse(err, requestId);
  }
}
