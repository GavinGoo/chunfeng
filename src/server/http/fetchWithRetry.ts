import { log } from '../log';
import { UpstreamError, type UpstreamSource } from './errors';

// 上游 HTTP 调用与重试（05 §5.1）。响应体在单次尝试内读完，超时同时覆盖排队与读取。

export interface RetryPolicy {
  maxAttempts: number;
  perAttemptTimeoutMs: number;
  baseDelayMs: number;
  maxDelayMs: number;
  jitter: number;
  maxRetryAfterMs: number;
  retryOn: (r: { status?: number; error?: unknown }) => boolean;
}

export interface RetryContext {
  deadline: number; // 绝对时间戳（ms）
  source: UpstreamSource;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  random?: () => number;
}

export interface UpstreamResponse {
  status: number;
  headers: Headers;
  text: string;
  attempts: number;
  upstreamRequestId?: string;
}

export const defaultRetryOn: RetryPolicy['retryOn'] = ({ status, error }) => {
  if (status !== undefined) return status === 408 || status === 429 || status >= 500;
  return error !== undefined;
};

export function defaultPolicy(
  overrides: Partial<RetryPolicy> & Pick<RetryPolicy, 'maxAttempts' | 'perAttemptTimeoutMs'>,
): RetryPolicy {
  return {
    baseDelayMs: 500,
    maxDelayMs: 5000,
    jitter: 0.25,
    maxRetryAfterMs: 10_000,
    retryOn: defaultRetryOn,
    ...overrides,
  };
}

/** 支持 retry-after-ms、Retry-After 秒数与 HTTP 日期 */
export function parseRetryAfter(headers: Headers, now: number = Date.now()): number | undefined {
  const ms = headers.get('retry-after-ms');
  if (ms !== null && ms.trim() !== '') {
    const v = Number(ms);
    if (Number.isFinite(v) && v >= 0) return v;
  }
  const ra = headers.get('retry-after');
  if (ra === null || ra.trim() === '') return undefined;
  const secs = Number(ra);
  if (Number.isFinite(secs) && secs >= 0) return secs * 1000;
  const date = Date.parse(ra);
  if (Number.isFinite(date)) return Math.max(0, date - now);
  return undefined;
}

export function computeDelay(
  attempt: number,
  policy: RetryPolicy,
  retryAfterMs?: number,
  random: () => number = Math.random,
): number {
  const exp = Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** (attempt - 1));
  const jittered = exp * (1 + policy.jitter * (random() * 2 - 1));
  return Math.round(retryAfterMs !== undefined ? Math.max(retryAfterMs, jittered) : jittered);
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
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

interface ParsedErrorBody {
  type?: string;
  message?: string;
}

/** 同时兼容网关的 OpenAI 风格错误体与官方格式 */
export function parseErrorBody(text: string): ParsedErrorBody {
  try {
    const j: unknown = JSON.parse(text);
    if (j && typeof j === 'object') {
      const o = j as Record<string, unknown>;
      const err = o.error;
      if (err && typeof err === 'object') {
        const e = err as Record<string, unknown>;
        return {
          type: typeof e.type === 'string' ? e.type : typeof e.code === 'string' ? e.code : undefined,
          message: typeof e.message === 'string' ? e.message : undefined,
        };
      }
      if (typeof err === 'string')
        return { message: err, type: typeof o.type === 'string' ? o.type : undefined };
      if (typeof o.message === 'string')
        return { message: o.message, type: typeof o.type === 'string' ? o.type : undefined };
      if (typeof o.detail === 'string') return { message: o.detail };
    }
  } catch {
    // 非 JSON
  }
  return text ? { message: text.slice(0, 200) } : {};
}

function httpError(
  source: UpstreamSource,
  res: { status: number; headers: Headers; text: string },
  attempts: number,
  retryable: boolean,
  retryAfterMs?: number,
): UpstreamError {
  const body = parseErrorBody(res.text);
  const misconfigured =
    !retryable && res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429;
  const err = new UpstreamError({
    source,
    kind: misconfigured ? 'MISCONFIGURED' : 'HTTP',
    retryable: !misconfigured,
    status: res.status,
    retryAfterMs,
    attempts,
    upstreamRequestId: res.headers.get('x-request-id') ?? undefined,
    upstreamType: body.type,
    upstreamMessage: body.message?.slice(0, 300),
  });
  const fields = {
    evt: 'upstream.error',
    source,
    status: res.status,
    code: err.kind,
    attempts,
    final: true,
    upstreamRequestId: err.upstreamRequestId,
    upstreamType: err.upstreamType,
    upstreamMessage: err.upstreamMessage,
  };
  if (res.status === 401 || res.status === 402) log().fatal(fields, '上游鉴权或余额异常');
  else if (misconfigured) log().error(fields, '上游请求被拒绝');
  else log().warn(fields, '上游请求失败');
  return err;
}

function isAbortFromCaller(signal?: AbortSignal): boolean {
  return signal?.aborted === true;
}

export async function fetchWithRetry(
  url: string,
  init: RequestInit,
  policy: RetryPolicy,
  ctx: RetryContext,
): Promise<UpstreamResponse> {
  const doFetch = ctx.fetchImpl ?? fetch;
  const now = ctx.now ?? Date.now;
  const wait = ctx.sleep ?? sleep;
  const random = ctx.random ?? Math.random;

  for (let attempt = 1; ; attempt++) {
    const remaining = ctx.deadline - now();
    if (remaining <= 0) {
      throw new UpstreamError({
        source: ctx.source,
        kind: 'TIMEOUT',
        retryable: true,
        attempts: attempt - 1,
      });
    }
    const timeout = Math.min(policy.perAttemptTimeoutMs, remaining);
    const signals = [AbortSignal.timeout(timeout), ctx.signal].filter((s): s is AbortSignal => !!s);
    let res: { status: number; headers: Headers; text: string };
    try {
      const r = await doFetch(url, { ...init, signal: AbortSignal.any(signals) });
      res = { status: r.status, headers: r.headers, text: await r.text() };
    } catch (e) {
      if (isAbortFromCaller(ctx.signal)) throw e;
      const isLast = attempt >= policy.maxAttempts;
      const deadlineHit = ctx.deadline - now() <= 0;
      if (!policy.retryOn({ error: e }) || isLast || deadlineHit) {
        log().warn(
          { evt: 'upstream.error', source: ctx.source, code: 'NETWORK', attempts: attempt, final: true },
          '上游网络错误',
        );
        throw new UpstreamError({
          source: ctx.source,
          kind: deadlineHit ? 'TIMEOUT' : 'NETWORK',
          retryable: true,
          attempts: attempt,
        });
      }
      const delay = computeDelay(attempt, policy, undefined, random);
      if (now() + delay + 1000 > ctx.deadline) {
        throw new UpstreamError({ source: ctx.source, kind: 'NETWORK', retryable: true, attempts: attempt });
      }
      log().warn({ evt: 'upstream.retry', source: ctx.source, attempt, code: 'NETWORK', delayMs: delay });
      await wait(delay, ctx.signal);
      continue;
    }

    const upstreamRequestId = res.headers.get('x-request-id') ?? undefined;
    if (res.status >= 200 && res.status < 300) {
      return { ...res, attempts: attempt, upstreamRequestId };
    }
    const retryable = policy.retryOn({ status: res.status });
    const retryAfter = parseRetryAfter(res.headers, now());
    if (!retryable || attempt >= policy.maxAttempts) {
      throw httpError(ctx.source, res, attempt, retryable, retryAfter);
    }
    const delay = computeDelay(attempt, policy, retryAfter, random);
    if (delay > policy.maxRetryAfterMs || now() + delay + 1000 > ctx.deadline) {
      throw httpError(ctx.source, res, attempt, true, retryAfter ?? delay);
    }
    log().warn({
      evt: 'upstream.retry',
      source: ctx.source,
      attempt,
      status: res.status,
      code: 'HTTP',
      delayMs: delay,
      upstreamRequestId,
    });
    await wait(delay, ctx.signal);
  }
}
