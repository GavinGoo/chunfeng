import type { Reading } from '@/lib/shared/types';
import type { ClientError } from './createReading';

// GET /api/readings/:id（04 §3）：浏览器前进 / 后退时恢复某条答案（07 §6）。不抛异常。

export type GetReadingResult = { ok: true; reading: Reading } | { ok: false; error: ClientError };

export async function getReading(
  id: string,
  opts: { signal?: AbortSignal; fetchImpl?: typeof fetch } = {},
): Promise<GetReadingResult> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return { ok: false, error: { code: 'OFFLINE', message: 'offline', retryable: true } };
  }
  try {
    const res = await (opts.fetchImpl ?? fetch)(`/api/readings/${encodeURIComponent(id)}`, {
      signal: opts.signal,
    });
    let json: unknown;
    try {
      json = await res.json();
    } catch {
      json = undefined;
    }
    const reading = (json as { reading?: Reading } | undefined)?.reading;
    if (res.ok && reading && typeof reading.id === 'string' && Array.isArray(reading.options)) {
      return { ok: true, reading };
    }
    if (res.status === 404) {
      return { ok: false, error: { code: 'NOT_FOUND', message: 'not found', retryable: false, status: 404 } };
    }
    return {
      ok: false,
      error: { code: 'INTERNAL', message: `http ${res.status}`, retryable: true, status: res.status },
    };
  } catch {
    if (opts.signal?.aborted) {
      return { ok: false, error: { code: 'ABORTED', message: 'aborted by caller', retryable: false } };
    }
    return { ok: false, error: { code: 'NETWORK', message: 'network error', retryable: true } };
  }
}
