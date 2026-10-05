import { AppError, errorResponse, toAppError } from '@/server/http/errors';
import { log } from '@/server/log';
import { getPublicReading } from '@/server/reading/public';

// GET /api/readings/[id]（04 §3）

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await ctx.params;
    const reading = getPublicReading(id);
    if (!reading) throw new AppError('NOT_FOUND', 'reading not found');
    return Response.json({ reading }, { headers: { 'Cache-Control': 'private, max-age=60' } });
  } catch (e) {
    const err = toAppError(e);
    if (err.code === 'INTERNAL') {
      log().error({ evt: 'reading.read_failed', err: e instanceof Error ? e.message : String(e) });
    }
    return errorResponse(err);
  }
}
