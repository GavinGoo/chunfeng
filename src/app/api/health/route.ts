import { visionStatus } from '@/server/image/vision';
import { log } from '@/server/log';
import { getRepository } from '@/server/reading/repository';
import pkg from '../../../../package.json';

// GET /api/health（13 §6）：只检查进程与数据库，不调用上游。vision 为图片功能的状态（15 §4）。

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VERSION = process.env.GIT_SHA || pkg.version;

export async function GET(): Promise<Response> {
  let db: 'ok' | 'error' = 'ok';
  try {
    if (!getRepository().ping()) db = 'error';
  } catch (e) {
    db = 'error';
    log().error({ evt: 'health.db_failed', err: e instanceof Error ? e.message : String(e) });
  }
  const ok = db === 'ok';
  return Response.json(
    { ok, version: VERSION, db, vision: visionStatus(), uptimeSec: Math.round(process.uptime()) },
    { status: ok ? 200 : 503, headers: { 'Cache-Control': 'no-store' } },
  );
}
