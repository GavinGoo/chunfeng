import type { ApiErrorBody, CreateReadingResponse, ErrorCode, Reading } from '@/lib/shared/types';

// 前端 API 客户端与重试策略（05 §6）：
//  尝试 1 → 成功返回；网络错误 / 超时 / 502 / 503 / 504 且 retryable → 等待 1.2 s → 尝试 2；
//  429 直接返回（带 retryAfterMs）；其他错误直接返回。
// 不抛异常，一律返回可辨识联合类型。

export const REQUEST_TIMEOUT_MS = 65_000; // 必须大于服务端总预算 50 s
export const RETRY_DELAY_MS = 1_200;

/** 客户端额外的错误码：网络层问题与主动取消 */
export type ClientErrorCode = ErrorCode | 'NETWORK' | 'TIMEOUT' | 'OFFLINE' | 'ABORTED';

export interface ClientError {
  code: ClientErrorCode;
  message: string; // 面向开发者；界面文案由 copy/zh.ts 按 code 决定
  retryable: boolean; // 是否应提供「再试一次」
  retryAfterMs?: number; // RATE_LIMITED 等：倒计时
  status?: number; // HTTP 状态码（网络层错误时无）
}

export type CreateReadingResult =
  | { ok: true; data: CreateReadingResponse; attempts: number }
  | { ok: false; error: ClientError; attempts: number };

export interface CreateReadingOptions {
  requestId: string; // 「这一次提问」的 UUID v4；错误页「再试一次」须复用
  regenOf?: string;
  imageId?: string; // 附图（15 §7.1）
  tz?: string; // 默认取浏览器时区
  signal?: AbortSignal; // 用户「合上书」时取消
  // 以下仅供测试注入
  fetchImpl?: typeof fetch;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  isOnline?: () => boolean;
  timeoutMs?: number;
  retryDelayMs?: number;
}

function browserTz(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
}

function defaultIsOnline(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine !== false;
}

function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(signal?.reason);
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

const aborted = (): ClientError => ({ code: 'ABORTED', message: 'aborted by caller', retryable: false });
const offline = (): ClientError => ({ code: 'OFFLINE', message: 'offline', retryable: true });

function retryAfterFromHeader(res: Response): number | undefined {
  const v = res.headers.get('retry-after');
  if (!v) return undefined;
  const secs = Number(v);
  return Number.isFinite(secs) && secs >= 0 ? secs * 1000 : undefined;
}

/** 无法解析错误体时（如 nginx 返回的 HTML 错误页），按状态码推断 */
function fallbackCode(status: number): { code: ErrorCode; retryable: boolean } {
  if (status === 429) return { code: 'RATE_LIMITED', retryable: true };
  if (status === 413) return { code: 'PAYLOAD_TOO_LARGE', retryable: false };
  if (status === 404) return { code: 'NOT_FOUND', retryable: false };
  if (status === 403) return { code: 'FORBIDDEN_ORIGIN', retryable: false };
  if (status === 504) return { code: 'UPSTREAM_TIMEOUT', retryable: true };
  if (status === 503) return { code: 'BUSY', retryable: true };
  if (status >= 500) return { code: 'INTERNAL', retryable: true };
  return { code: 'BAD_REQUEST', retryable: false };
}

function isApiErrorBody(v: unknown): v is ApiErrorBody {
  if (!v || typeof v !== 'object') return false;
  const e = (v as { error?: unknown }).error;
  return !!e && typeof e === 'object' && typeof (e as { code?: unknown }).code === 'string';
}

function isCreateReadingResponse(v: unknown): v is CreateReadingResponse {
  if (!v || typeof v !== 'object') return false;
  const o = v as { status?: unknown; reading?: unknown; message?: unknown };
  if (o.status === 'ok') {
    const r = o.reading as Partial<Reading> | undefined;
    return !!r && typeof r.id === 'string' && Array.isArray(r.options) && r.options.length === 4;
  }
  return (
    (o.status === 'unclear' || o.status === 'sensitive' || o.status === 'refused') &&
    typeof o.message === 'string'
  );
}

async function attemptOnce(
  body: string,
  opts: CreateReadingOptions,
): Promise<{ ok: true; data: CreateReadingResponse } | { ok: false; error: ClientError }> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, opts.timeoutMs ?? REQUEST_TIMEOUT_MS);
  const onCallerAbort = () => controller.abort();
  opts.signal?.addEventListener('abort', onCallerAbort, { once: true });
  try {
    const res = await (opts.fetchImpl ?? fetch)('/api/readings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal: controller.signal,
      cache: 'no-store',
    });
    let json: unknown;
    try {
      json = await res.json();
    } catch {
      json = undefined;
    }
    if (res.ok) {
      if (isCreateReadingResponse(json)) return { ok: true, data: json };
      return {
        ok: false,
        error: { code: 'INTERNAL', message: 'unexpected response body', retryable: true, status: res.status },
      };
    }
    if (isApiErrorBody(json)) {
      const e = json.error;
      return {
        ok: false,
        error: {
          code: e.code,
          message: e.message,
          retryable: e.retryable,
          retryAfterMs: e.retryAfterMs ?? retryAfterFromHeader(res),
          status: res.status,
        },
      };
    }
    const fb = fallbackCode(res.status);
    return {
      ok: false,
      error: {
        ...fb,
        message: `http ${res.status}`,
        status: res.status,
        retryAfterMs: retryAfterFromHeader(res),
      },
    };
  } catch {
    if (opts.signal?.aborted) return { ok: false, error: aborted() };
    if (timedOut)
      return { ok: false, error: { code: 'TIMEOUT', message: 'request timed out', retryable: true } };
    return { ok: false, error: { code: 'NETWORK', message: 'network error', retryable: true } };
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener('abort', onCallerAbort);
  }
}

function shouldAutoRetry(e: ClientError): boolean {
  if (e.code === 'NETWORK' || e.code === 'TIMEOUT') return true;
  return e.retryable && (e.status === 502 || e.status === 503 || e.status === 504);
}

export async function createReading(
  question: string,
  opts: CreateReadingOptions,
): Promise<CreateReadingResult> {
  const isOnline = opts.isOnline ?? defaultIsOnline;
  if (opts.signal?.aborted) return { ok: false, error: aborted(), attempts: 0 };
  if (!isOnline()) return { ok: false, error: offline(), attempts: 0 };

  const tz = opts.tz ?? browserTz();
  const body = JSON.stringify({
    question,
    requestId: opts.requestId,
    ...(tz ? { tz } : {}),
    ...(opts.regenOf ? { regenOf: opts.regenOf } : {}),
    ...(opts.imageId ? { imageId: opts.imageId } : {}),
  });

  const first = await attemptOnce(body, opts);
  if (first.ok) return { ...first, attempts: 1 };
  if (!shouldAutoRetry(first.error)) return { ...first, attempts: 1 };

  try {
    await (opts.sleep ?? defaultSleep)(opts.retryDelayMs ?? RETRY_DELAY_MS, opts.signal);
  } catch {
    return { ok: false, error: aborted(), attempts: 1 };
  }
  if (opts.signal?.aborted) return { ok: false, error: aborted(), attempts: 1 };
  if (!isOnline()) return { ok: false, error: offline(), attempts: 1 };

  const second = await attemptOnce(body, opts);
  return { ...second, attempts: 2 };
}
