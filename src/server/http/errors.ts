import type { ApiErrorBody, ErrorCode } from '@/lib/shared/types';

export type UpstreamSource = 'llm' | 'jev';
// CONTENT_REJECTED：上游内容风控拦截（15 §8.4），编排层转为 refused 分流，不是错误
export type UpstreamErrorKind =
  | 'HTTP'
  | 'NETWORK'
  | 'TIMEOUT'
  | 'BAD_OUTPUT'
  | 'MISCONFIGURED'
  | 'CONTENT_REJECTED';

export interface UpstreamErrorInit {
  source: UpstreamSource;
  kind: UpstreamErrorKind;
  retryable: boolean;
  status?: number;
  retryAfterMs?: number;
  attempts?: number;
  upstreamRequestId?: string;
  upstreamType?: string;
  upstreamMessage?: string;
}

/** 上游调用失败（05 §5.1）。不携带任何请求头或密钥。 */
export class UpstreamError extends Error {
  readonly source: UpstreamSource;
  readonly kind: UpstreamErrorKind;
  readonly retryable: boolean;
  readonly status?: number;
  readonly retryAfterMs?: number;
  attempts: number;
  readonly upstreamRequestId?: string;
  readonly upstreamType?: string;
  readonly upstreamMessage?: string;

  constructor(init: UpstreamErrorInit) {
    super(`${init.source} ${init.kind}${init.status ? ` ${init.status}` : ''}`);
    this.name = 'UpstreamError';
    this.source = init.source;
    this.kind = init.kind;
    this.retryable = init.retryable;
    this.status = init.status;
    this.retryAfterMs = init.retryAfterMs;
    this.attempts = init.attempts ?? 1;
    this.upstreamRequestId = init.upstreamRequestId;
    this.upstreamType = init.upstreamType;
    this.upstreamMessage = init.upstreamMessage;
  }
}

const HTTP_STATUS: Record<ErrorCode, number> = {
  BAD_REQUEST: 400,
  PAYLOAD_TOO_LARGE: 413,
  FORBIDDEN_ORIGIN: 403,
  NOT_FOUND: 404,
  RATE_LIMITED: 429,
  BUSY: 503,
  LLM_UNAVAILABLE: 502,
  LLM_BAD_OUTPUT: 502,
  JEV_UNAVAILABLE: 502,
  UPSTREAM_TIMEOUT: 504,
  SERVICE_MISCONFIGURED: 503,
  UNSUPPORTED_MEDIA: 415,
  IMAGE_UNREADABLE: 422,
  IMAGE_NOT_FOUND: 400,
  VISION_DISABLED: 400,
  INTERNAL: 500,
};

const RETRYABLE: Record<ErrorCode, boolean> = {
  BAD_REQUEST: false,
  PAYLOAD_TOO_LARGE: false,
  FORBIDDEN_ORIGIN: false,
  NOT_FOUND: false,
  RATE_LIMITED: true,
  BUSY: true,
  LLM_UNAVAILABLE: true,
  LLM_BAD_OUTPUT: true,
  JEV_UNAVAILABLE: true,
  UPSTREAM_TIMEOUT: true,
  SERVICE_MISCONFIGURED: false,
  UNSUPPORTED_MEDIA: false,
  IMAGE_UNREADABLE: false,
  IMAGE_NOT_FOUND: false,
  VISION_DISABLED: false,
  INTERNAL: true,
};

/** 对外错误（05 §2） */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly httpStatus: number;
  readonly retryable: boolean;
  readonly retryAfterMs?: number;

  constructor(code: ErrorCode, message: string, opts: { retryAfterMs?: number } = {}) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.httpStatus = HTTP_STATUS[code];
    this.retryable = RETRYABLE[code];
    this.retryAfterMs = opts.retryAfterMs;
  }
}

export function upstreamToAppError(e: UpstreamError): AppError {
  const opts = { retryAfterMs: e.retryAfterMs };
  if (e.kind === 'MISCONFIGURED') return new AppError('SERVICE_MISCONFIGURED', `${e.source} misconfigured`);
  // 编排层会把 CONTENT_REJECTED 转为 refused；走到这里说明调用方未处理，按上游不可用对待
  if (e.kind === 'CONTENT_REJECTED') return new AppError('LLM_UNAVAILABLE', 'llm content rejected');
  if (e.kind === 'TIMEOUT') return new AppError('UPSTREAM_TIMEOUT', 'reading deadline exceeded', opts);
  if (e.source === 'llm') {
    return e.kind === 'BAD_OUTPUT'
      ? new AppError('LLM_BAD_OUTPUT', 'llm output invalid', opts)
      : new AppError('LLM_UNAVAILABLE', 'llm unavailable', opts);
  }
  return new AppError('JEV_UNAVAILABLE', 'jev unavailable', opts);
}

export function toAppError(e: unknown): AppError {
  if (e instanceof AppError) return e;
  if (e instanceof UpstreamError) return upstreamToAppError(e);
  return new AppError('INTERNAL', 'internal error');
}

export function errorBody(e: AppError, requestId?: string): ApiErrorBody {
  return {
    error: {
      code: e.code,
      message: e.message,
      retryable: e.retryable,
      ...(e.retryAfterMs !== undefined ? { retryAfterMs: Math.ceil(e.retryAfterMs) } : {}),
      ...(requestId ? { requestId } : {}),
    },
  };
}

export function errorResponse(e: AppError, requestId?: string): Response {
  const headers: Record<string, string> = { 'Cache-Control': 'no-store' };
  if ((e.httpStatus === 429 || e.httpStatus === 503) && e.retryAfterMs !== undefined) {
    headers['Retry-After'] = String(Math.max(1, Math.ceil(e.retryAfterMs / 1000)));
  }
  return Response.json(errorBody(e, requestId), { status: e.httpStatus, headers });
}
