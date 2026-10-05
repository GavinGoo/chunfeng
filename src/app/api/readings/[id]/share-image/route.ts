import { getConfig } from '@/server/config';
import { AppError, errorResponse, toAppError } from '@/server/http/errors';
import { isSameSiteRequest, requestBaseUrl } from '@/server/http/origin';
import { log } from '@/server/log';
import { getPublicReading } from '@/server/reading/public';
import {
  cachePath,
  cacheStat,
  etagFor,
  ifNoneMatchHits,
  readCache,
  writeCacheAtomic,
} from '@/server/share/cache';
import { renderShareImage } from '@/server/share/render';

// GET /api/readings/[id]/share-image（12 §3.1）
// 一篇答案一张图（D35）：第一次请求渲染并落盘，之后永远返回这个文件，模板 / 域名变动都不重渲染；
// 要换只能人工删掉 `${SHARE_CACHE_DIR}/${id}.png`。查询参数 r 只用于绕过浏览器缓存（前端「重试」）。
// 二维码用请求自身的域名；只有「看起来来自本站」的请求才落盘、固化它，其余照常渲染但不落盘（D35、D45）。

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// 每次使用前都回源校验（D37）：浏览器可以存图，但必须带着 If-None-Match 问一次，
// 命中就回 304（一次 stat，约 1 ms），否则重传。这样磁盘上的文件是唯一权威——删掉它，
// 所有人的下一次请求就会重新渲染。不用 no-store：那会每次重传约 750 KB。
const CACHE_CONTROL = 'public, no-cache';

/** 同一张图并发请求只渲染一次 */
const g = globalThis as typeof globalThis & { __chunfengShareInflight?: Map<string, Promise<Buffer>> };
function inflight(): Map<string, Promise<Buffer>> {
  g.__chunfengShareInflight ??= new Map();
  return g.__chunfengShareInflight;
}

function pngResponse(body: Buffer | null, etag: string, status = 200): Response {
  const headers = { 'Content-Type': 'image/png', 'Cache-Control': CACHE_CONTROL, ETag: etag };
  if (!body) return new Response(null, { status: 304, headers });
  return new Response(new Uint8Array(body), {
    status,
    headers: { ...headers, 'Content-Length': String(body.length) },
  });
}

/** 没有落盘的图只属于这一次请求：不让任何缓存留存，也不给 ETag（磁盘上没有与之对应的文件） */
function transientPngResponse(body: Buffer): Response {
  return new Response(new Uint8Array(body), {
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'no-store',
      'Content-Length': String(body.length),
    },
  });
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const startedAt = Date.now();
  let id = '';
  try {
    id = (await ctx.params).id;
    const reading = getPublicReading(id);
    if (!reading) throw new AppError('NOT_FOUND', 'reading not found');

    const cfg = getConfig();
    const file = cachePath(cfg.shareCacheDir, id);
    const ifNoneMatch = req.headers.get('if-none-match');

    // 1. 磁盘缓存
    const cached = await cacheStat(file);
    if (cached) {
      const etag = etagFor(id, cached.size);
      if (ifNoneMatchHits(ifNoneMatch, etag)) return pngResponse(null, etag);
      const body = await readCache(file);
      if (body) return pngResponse(body, etagFor(id, body.length));
    }

    // 2. 渲染（并发上限在 renderShareImage 内）→ 3. 本站请求才原子写入缓存（D45）
    const baseUrl = requestBaseUrl(req.headers);
    if (!baseUrl) throw new AppError('BAD_REQUEST', 'missing or invalid host');
    const persist = isSameSiteRequest(req.headers);
    // 落盘的一篇答案只有一张图，按 id 合并；不落盘的按域名分开，免得本站请求拿到它、或它混进落盘的那张
    const key = persist ? id : `${id} ${baseUrl}`;
    let job = inflight().get(key);
    if (!job) {
      job = (async () => {
        const png = await renderShareImage(reading, { baseUrl });
        if (persist) {
          try {
            await writeCacheAtomic(file, png);
          } catch (e) {
            // 缓存写入失败不影响本次响应
            log().warn({ evt: 'share.cache_write_failed', err: e instanceof Error ? e.message : String(e) });
          }
        }
        return png;
      })().finally(() => inflight().delete(key));
      inflight().set(key, job);
    }
    const png = await job;
    log().info({
      evt: 'share.rendered',
      id,
      persisted: persist,
      ms: Date.now() - startedAt,
      bytes: png.length,
    });
    return persist ? pngResponse(png, etagFor(id, png.length)) : transientPngResponse(png);
  } catch (e) {
    const err = toAppError(e);
    if (err.code === 'INTERNAL') {
      log().error({ evt: 'share.render_failed', id, err: e instanceof Error ? e.message : String(e) });
    }
    return errorResponse(err);
  }
}
