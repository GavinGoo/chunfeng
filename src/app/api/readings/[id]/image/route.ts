import { isReadingId } from '@/lib/shared/ids';
import { AppError, errorResponse, toAppError } from '@/server/http/errors';
import { readImage } from '@/server/image/store';
import { log } from '@/server/log';
import { getRepository } from '@/server/reading/repository';
import { ifNoneMatchHits } from '@/server/share/cache';

// GET /api/readings/[id]/image?size=thumb|full（15 §7.4）
// 经答案的 id 取图，imageId 不公开。不受 LLM_VISION 影响：关闭开关后，已有答案中的相片照常显示。

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  let id = '';
  try {
    id = (await ctx.params).id;
    const sizeParam = new URL(req.url).searchParams.get('size');
    if (sizeParam !== null && sizeParam !== 'thumb' && sizeParam !== 'full') {
      throw new AppError('BAD_REQUEST', 'size must be thumb or full');
    }
    const size = sizeParam ?? 'thumb';
    if (!isReadingId(id)) throw new AppError('NOT_FOUND', 'reading not found');
    const ref = getRepository().getImageForReading(id);
    if (!ref) throw new AppError('NOT_FOUND', 'image not found');

    const etag = `"${ref.sha256.slice(0, 16)}-${size}"`;
    const headers: Record<string, string> = {
      'Content-Type': 'image/jpeg',
      'Cache-Control': 'public, max-age=31536000, immutable',
      ETag: etag,
      'Cross-Origin-Resource-Policy': 'same-origin', // 防外站盗链
      'X-Robots-Tag': 'noindex',
      'Content-Disposition': `inline; filename="chunfeng-${id}.jpg"`,
    };
    if (ifNoneMatchHits(req.headers.get('if-none-match'), etag)) {
      return new Response(null, { status: 304, headers });
    }
    const body = await readImage(ref.imageId, size);
    if (!body) throw new AppError('NOT_FOUND', 'image file missing');
    return new Response(new Uint8Array(body), {
      headers: { ...headers, 'Content-Length': String(body.length) },
    });
  } catch (e) {
    const err = toAppError(e);
    if (err.code === 'INTERNAL') {
      log().error({ evt: 'image.read_failed', id, err: e instanceof Error ? e.message : String(e) });
    }
    return errorResponse(err);
  }
}
