import { describe, expect, it, vi } from 'vitest';
import { UpstreamError } from '@/server/http/errors';
import {
  computeDelay,
  defaultPolicy,
  fetchWithRetry,
  parseRetryAfter,
  type RetryContext,
} from '@/server/http/fetchWithRetry';

// 假时钟：sleep 只推进时间，不真正等待
function harness(
  responses: Array<Response | Error | (() => Response | Promise<Response>)>,
  start = 1_000_000,
) {
  let t = start;
  const sleeps: number[] = [];
  const calls: number[] = [];
  const fetchImpl = vi.fn(async () => {
    calls.push(t);
    const next = responses.shift();
    if (next === undefined) throw new Error('no more responses');
    if (next instanceof Error) throw next;
    return typeof next === 'function' ? next() : next;
  }) as unknown as typeof fetch;
  const ctx = (deadlineIn: number, extra: Partial<RetryContext> = {}): RetryContext => ({
    deadline: start + deadlineIn,
    source: 'jev',
    fetchImpl,
    now: () => t,
    sleep: async (ms: number) => {
      sleeps.push(ms);
      t += ms;
    },
    random: () => 0.5, // 无抖动
    ...extra,
  });
  return { ctx, sleeps, calls, fetchImpl, advance: (ms: number) => (t += ms) };
}

const policy = defaultPolicy({ maxAttempts: 4, perAttemptTimeoutMs: 8000 });
const status = (s: number, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify({ error: { message: `e${s}`, type: 't' } }), { status: s, headers });
const ok = () => new Response('{"ok":true}', { status: 200, headers: { 'x-request-id': 'rid-ok' } });

describe('fetchWithRetry（05 §5.1）', () => {
  it('成功：读完响应体并返回尝试次数', async () => {
    const h = harness([ok()]);
    const r = await fetchWithRetry('http://x', {}, policy, h.ctx(50_000));
    expect(r).toMatchObject({ status: 200, text: '{"ok":true}', attempts: 1, upstreamRequestId: 'rid-ok' });
  });

  it.each([408, 429, 500, 502, 503, 529])('%i 可重试，指数退避', async (s) => {
    const h = harness([status(s), status(s), ok()]);
    const r = await fetchWithRetry('http://x', {}, policy, h.ctx(50_000));
    expect(r.attempts).toBe(3);
    expect(h.sleeps).toEqual([500, 1000]);
  });

  it.each([400, 401, 402, 403, 404, 422])('%i 不重试 → MISCONFIGURED', async (s) => {
    const h = harness([status(s)]);
    const err = (await fetchWithRetry('http://x', {}, policy, h.ctx(50_000)).catch(
      (e) => e,
    )) as UpstreamError;
    expect(err).toBeInstanceOf(UpstreamError);
    expect(err.kind).toBe('MISCONFIGURED');
    expect(err.retryable).toBe(false);
    expect(h.fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('尝试次数耗尽 → HTTP 错误（可重试）', async () => {
    const h = harness([status(503), status(503), status(503), status(503)]);
    const err = (await fetchWithRetry('http://x', {}, policy, h.ctx(50_000)).catch(
      (e) => e,
    )) as UpstreamError;
    expect(err.kind).toBe('HTTP');
    expect(err.status).toBe(503);
    expect(err.attempts).toBe(4);
    expect(h.sleeps).toEqual([500, 1000, 2000]);
  });

  it('退避上限 5 s 与 ±25% 抖动', () => {
    expect(computeDelay(10, policy, undefined, () => 0.5)).toBe(5000);
    expect(computeDelay(1, policy, undefined, () => 0)).toBe(375);
    expect(computeDelay(1, policy, undefined, () => 1)).toBe(625);
    expect(computeDelay(1, policy, 3000, () => 0.5)).toBe(3000); // Retry-After 较大时取较大值
  });

  describe('Retry-After', () => {
    it('秒数', async () => {
      const h = harness([status(429, { 'retry-after': '3' }), ok()]);
      await fetchWithRetry('http://x', {}, policy, h.ctx(50_000));
      expect(h.sleeps).toEqual([3000]);
    });

    it('HTTP 日期', async () => {
      const start = Date.UTC(2026, 8, 27, 12, 0, 0);
      const h = harness([status(503, { 'retry-after': new Date(start + 4000).toUTCString() }), ok()], start);
      await fetchWithRetry('http://x', {}, policy, h.ctx(50_000));
      expect(h.sleeps).toEqual([4000]);
    });

    it('retry-after-ms 优先', async () => {
      const h = harness([status(529, { 'retry-after-ms': '1500', 'retry-after': '9' }), ok()]);
      await fetchWithRetry('http://x', {}, policy, h.ctx(50_000));
      expect(h.sleeps).toEqual([1500]);
    });

    it('超过 10 s 上限 → 不等待，直接失败并透传 retryAfterMs', async () => {
      const h = harness([status(429, { 'retry-after': '30' })]);
      const err = (await fetchWithRetry('http://x', {}, policy, h.ctx(50_000)).catch(
        (e) => e,
      )) as UpstreamError;
      expect(err.kind).toBe('HTTP');
      expect(err.retryAfterMs).toBe(30_000);
      expect(h.sleeps).toEqual([]);
    });

    it('parseRetryAfter 忽略非法值', () => {
      expect(parseRetryAfter(new Headers({ 'retry-after': 'soon' }))).toBeUndefined();
      expect(parseRetryAfter(new Headers())).toBeUndefined();
      expect(parseRetryAfter(new Headers({ 'retry-after': '0' }))).toBe(0);
    });
  });

  describe('deadline', () => {
    it('等待后会超出预算 → 立即放弃，不做注定失败的尝试', async () => {
      const h = harness([status(503), ok()]);
      // 剩余 1.2 s：等待 500 ms + 1 s 余量 > 预算
      const err = (await fetchWithRetry('http://x', {}, policy, h.ctx(1200)).catch(
        (e) => e,
      )) as UpstreamError;
      expect(err).toBeInstanceOf(UpstreamError);
      expect(h.fetchImpl).toHaveBeenCalledTimes(1);
      expect(h.sleeps).toEqual([]);
    });

    it('预算已耗尽 → TIMEOUT，不发请求', async () => {
      const h = harness([ok()]);
      const err = (await fetchWithRetry('http://x', {}, policy, h.ctx(0)).catch((e) => e)) as UpstreamError;
      expect(err.kind).toBe('TIMEOUT');
      expect(h.fetchImpl).not.toHaveBeenCalled();
    });

    it('单次超时取 min(perAttemptTimeout, 剩余预算)', async () => {
      const h = harness([]);
      let seen: AbortSignal | undefined;
      const fetchImpl = vi.fn(async (_u: string, init?: RequestInit) => {
        seen = init?.signal ?? undefined;
        return await new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
        });
      }) as unknown as typeof fetch;
      const started = Date.now();
      const err = (await fetchWithRetry(
        'http://x',
        {},
        policy,
        h.ctx(0, { deadline: Date.now() + 80, now: Date.now, fetchImpl }),
      ).catch((e) => e)) as UpstreamError;
      expect(seen?.aborted).toBe(true);
      expect(err.kind).toBe('TIMEOUT');
      expect(Date.now() - started).toBeLessThan(2000);
    });

    it('网络错误可重试', async () => {
      const h = harness([new TypeError('fetch failed'), ok()]);
      const r = await fetchWithRetry('http://x', {}, policy, h.ctx(50_000));
      expect(r.attempts).toBe(2);
      expect(h.sleeps).toEqual([500]);
    });

    it('网络错误耗尽 → NETWORK', async () => {
      const e = () => new TypeError('fetch failed');
      const h = harness([e(), e(), e(), e()]);
      const err = (await fetchWithRetry('http://x', {}, policy, h.ctx(50_000)).catch(
        (x) => x,
      )) as UpstreamError;
      expect(err.kind).toBe('NETWORK');
      expect(err.attempts).toBe(4);
    });
  });

  it('调用方取消：不重试，原样抛出', async () => {
    const controller = new AbortController();
    const h = harness([
      () => {
        controller.abort(new DOMException('closed', 'AbortError'));
        throw new DOMException('closed', 'AbortError');
      },
      ok(),
    ]);
    const err = await fetchWithRetry(
      'http://x',
      {},
      policy,
      h.ctx(50_000, { signal: controller.signal }),
    ).catch((e) => e);
    expect(err).not.toBeInstanceOf(UpstreamError);
    expect((err as DOMException).name).toBe('AbortError');
    expect(h.fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('调用方在退避等待中取消', async () => {
    const controller = new AbortController();
    const h = harness([status(503), ok()]);
    const err = await fetchWithRetry(
      'http://x',
      {},
      policy,
      h.ctx(50_000, {
        signal: controller.signal,
        sleep: async () => {
          controller.abort(new DOMException('closed', 'AbortError'));
          throw controller.signal.reason;
        },
      }),
    ).catch((e) => e);
    expect((err as DOMException).name).toBe('AbortError');
    expect(h.fetchImpl).toHaveBeenCalledTimes(1);
  });
});
