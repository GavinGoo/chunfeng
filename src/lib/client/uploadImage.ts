import type { UploadImageResponse } from '@/lib/shared/image';
import type { ApiErrorBody } from '@/lib/shared/types';
import type { ClientError } from './createReading';

// 上传图片（15 §10.6）：选图后立即上传，超时 30 s。网络错误，或 502 / 503 / 504 且 retryable 时自动重试 1 次。
// 与 createReading 一样返回可辨识联合，不抛异常。

export const UPLOAD_TIMEOUT_MS = 30_000;
export const UPLOAD_RETRY_DELAY_MS = 1_200;

export type UploadImageResult = { ok: true; data: UploadImageResponse } | { ok: false; error: ClientError };

export interface UploadImageOptions {
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  retryDelayMs?: number;
}

function isUploadResponse(v: unknown): v is UploadImageResponse {
  if (!v || typeof v !== 'object') return false;
  const o = v as Partial<UploadImageResponse>;
  return typeof o.imageId === 'string' && typeof o.width === 'number' && typeof o.height === 'number';
}

function isApiErrorBody(v: unknown): v is ApiErrorBody {
  if (!v || typeof v !== 'object') return false;
  const e = (v as { error?: unknown }).error;
  return !!e && typeof e === 'object' && typeof (e as { code?: unknown }).code === 'string';
}

function fallback(status: number): ClientError {
  if (status === 413) return { code: 'PAYLOAD_TOO_LARGE', message: 'http 413', retryable: false, status };
  if (status === 415) return { code: 'UNSUPPORTED_MEDIA', message: 'http 415', retryable: false, status };
  if (status === 429) return { code: 'RATE_LIMITED', message: 'http 429', retryable: true, status };
  if (status >= 500) return { code: 'BUSY', message: `http ${status}`, retryable: true, status };
  return { code: 'BAD_REQUEST', message: `http ${status}`, retryable: false, status };
}

async function attempt(blob: Blob, opts: UploadImageOptions): Promise<UploadImageResult> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, opts.timeoutMs ?? UPLOAD_TIMEOUT_MS);
  const onAbort = () => controller.abort();
  opts.signal?.addEventListener('abort', onAbort, { once: true });
  try {
    const res = await (opts.fetchImpl ?? fetch)('/api/uploads', {
      method: 'POST',
      headers: { 'Content-Type': blob.type || 'application/octet-stream' },
      body: blob,
      signal: controller.signal,
      cache: 'no-store',
    });
    let json: unknown;
    try {
      json = await res.json();
    } catch {
      json = undefined;
    }
    if (res.ok && isUploadResponse(json)) return { ok: true, data: json };
    if (isApiErrorBody(json)) {
      const e = json.error;
      const ra = Number(res.headers.get('retry-after'));
      return {
        ok: false,
        error: {
          code: e.code,
          message: e.message,
          retryable: e.retryable,
          retryAfterMs: e.retryAfterMs ?? (Number.isFinite(ra) && ra > 0 ? ra * 1000 : undefined),
          status: res.status,
        },
      };
    }
    return { ok: false, error: fallback(res.status) };
  } catch {
    if (opts.signal?.aborted)
      return { ok: false, error: { code: 'ABORTED', message: 'aborted', retryable: false } };
    if (timedOut)
      return { ok: false, error: { code: 'TIMEOUT', message: 'upload timed out', retryable: true } };
    return { ok: false, error: { code: 'NETWORK', message: 'network error', retryable: true } };
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener('abort', onAbort);
  }
}

function shouldRetry(e: ClientError): boolean {
  if (e.code === 'NETWORK' || e.code === 'TIMEOUT') return true;
  return e.retryable && (e.status === 502 || e.status === 503 || e.status === 504);
}

export async function uploadImage(blob: Blob, opts: UploadImageOptions = {}): Promise<UploadImageResult> {
  const first = await attempt(blob, opts);
  if (first.ok || !shouldRetry(first.error)) return first;
  await new Promise((r) => setTimeout(r, opts.retryDelayMs ?? UPLOAD_RETRY_DELAY_MS));
  if (opts.signal?.aborted)
    return { ok: false, error: { code: 'ABORTED', message: 'aborted', retryable: false } };
  return attempt(blob, opts);
}
