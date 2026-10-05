import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createReading } from '@/lib/client/createReading';
import {
  addMine,
  clearDraft,
  getDraft,
  getMine,
  hasSeenHint,
  isMine,
  MINE_MAX,
  markHintSeen,
  STORAGE_KEYS,
  setDraft,
} from '@/lib/client/storage';
import { randomUUID, uuidFromBytes } from '@/lib/client/uuid';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const reading = {
  id: 'AAAAAAAAAAAA',
  question: 'q',
  createdAt: '2026-09-27T13:40:12.345Z',
  tz: 'Asia/Shanghai',
  pageNo: 237,
  options: (['A', 'B', 'C', 'D'] as const).map((letter) => ({
    letter,
    title: 't',
    desc: 'd',
    prob: 0.25,
    pct: 25,
  })),
};
const okRes = () => Response.json({ status: 'ok', reading });
const errRes = (status: number, code: string, retryable: boolean, extra: Record<string, unknown> = {}) =>
  Response.json({ error: { code, message: code, retryable, ...extra } }, { status });

function setup(responses: Array<Response | Error>) {
  const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
    const next = responses.shift();
    if (!next) throw new Error('no more');
    if (init?.signal?.aborted) throw new DOMException('aborted', 'AbortError');
    if (next instanceof Error) throw next;
    return next;
  });
  const sleep = vi.fn(async (_ms: number) => {});
  return {
    fetchImpl,
    sleep,
    opts: {
      requestId: '0b6f8f3e-6a0e-4f0b-9a57-1d2a6c1b9e21',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep,
      isOnline: () => true,
      tz: 'Asia/Shanghai',
    },
  };
}

describe('createReading（05 §6）', () => {
  it('成功：请求体包含 question、requestId、tz、regenOf', async () => {
    const s = setup([okRes()]);
    const r = await createReading('要不要换工作？', { ...s.opts, regenOf: 'BBBBBBBBBBBB' });
    expect(r).toMatchObject({
      ok: true,
      attempts: 1,
      data: { status: 'ok', reading: { id: 'AAAAAAAAAAAA' } },
    });
    const [url, init] = s.fetchImpl.mock.calls[0]!;
    expect(url).toBe('/api/readings');
    expect(JSON.parse(String(init?.body))).toEqual({
      question: '要不要换工作？',
      requestId: s.opts.requestId,
      tz: 'Asia/Shanghai',
      regenOf: 'BBBBBBBBBBBB',
    });
  });

  it('分流结果原样返回', async () => {
    const s = setup([Response.json({ status: 'sensitive', message: '', resources: [] })]);
    const r = await createReading('q', s.opts);
    expect(r).toMatchObject({ ok: true, data: { status: 'sensitive' } });
  });

  it.each([
    [502, 'JEV_UNAVAILABLE'],
    [503, 'BUSY'],
    [504, 'UPSTREAM_TIMEOUT'],
  ])('%i 且 retryable：等待 1.2 s 后静默重试一次（复用 requestId）', async (status, code) => {
    const s = setup([errRes(status, code, true), okRes()]);
    const r = await createReading('q', s.opts);
    expect(r).toMatchObject({ ok: true, attempts: 2 });
    expect(s.sleep).toHaveBeenCalledWith(1200, undefined);
    const bodies = s.fetchImpl.mock.calls.map((c) => JSON.parse(String(c[1]?.body)).requestId);
    expect(bodies[0]).toBe(bodies[1]);
  });

  it('网络错误：重试一次，仍失败则返回错误', async () => {
    const s = setup([new TypeError('Failed to fetch'), new TypeError('Failed to fetch')]);
    const r = await createReading('q', s.opts);
    expect(r).toMatchObject({ ok: false, attempts: 2, error: { code: 'NETWORK', retryable: true } });
  });

  it('429：不重试，直接返回 retryAfterMs', async () => {
    const s = setup([errRes(429, 'RATE_LIMITED', true, { retryAfterMs: 7500 })]);
    const r = await createReading('q', s.opts);
    expect(r).toMatchObject({ ok: false, attempts: 1, error: { code: 'RATE_LIMITED', retryAfterMs: 7500 } });
    expect(s.fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('SERVICE_MISCONFIGURED（503 但不可重试）：不重试', async () => {
    const s = setup([errRes(503, 'SERVICE_MISCONFIGURED', false)]);
    const r = await createReading('q', s.opts);
    expect(r).toMatchObject({
      ok: false,
      attempts: 1,
      error: { code: 'SERVICE_MISCONFIGURED', retryable: false },
    });
  });

  it('非 JSON 错误页（如 nginx 502）：按状态码推断并重试', async () => {
    const s = setup([new Response('<html>502</html>', { status: 502 }), okRes()]);
    const r = await createReading('q', s.opts);
    expect(r).toMatchObject({ ok: true, attempts: 2 });
  });

  it('离线：不发请求', async () => {
    const s = setup([okRes()]);
    const r = await createReading('q', { ...s.opts, isOnline: () => false });
    expect(r).toMatchObject({ ok: false, attempts: 0, error: { code: 'OFFLINE' } });
    expect(s.fetchImpl).not.toHaveBeenCalled();
  });

  it('调用方取消：返回 ABORTED，不重试', async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn(
      (_u: string, init?: RequestInit) =>
        new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('a', 'AbortError')));
        }),
    );
    const p = createReading('q', {
      requestId: 'x',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      isOnline: () => true,
      signal: controller.signal,
    });
    controller.abort();
    expect(await p).toMatchObject({ ok: false, error: { code: 'ABORTED' } });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('65 s 超时（此处缩短）→ TIMEOUT，并重试一次', async () => {
    const fetchImpl = vi.fn(
      (_u: string, init?: RequestInit) =>
        new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('a', 'AbortError')));
        }),
    );
    const r = await createReading('q', {
      requestId: 'x',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      isOnline: () => true,
      timeoutMs: 20,
      retryDelayMs: 1,
    });
    expect(r).toMatchObject({ ok: false, attempts: 2, error: { code: 'TIMEOUT' } });
  });
});

describe('uuid', () => {
  it('randomUUID 为 v4', () => {
    expect(randomUUID()).toMatch(UUID_V4);
  });

  it('getRandomValues 回退实现也是合法的 v4', () => {
    expect(uuidFromBytes(new Uint8Array(16).fill(0xff))).toMatch(UUID_V4);
    expect(uuidFromBytes(new Uint8Array(16))).toBe('00000000-0000-4000-8000-000000000000');
    const original = globalThis.crypto.randomUUID;
    Object.defineProperty(globalThis.crypto, 'randomUUID', { value: undefined, configurable: true });
    try {
      expect(randomUUID()).toMatch(UUID_V4);
    } finally {
      Object.defineProperty(globalThis.crypto, 'randomUUID', { value: original, configurable: true });
    }
  });
});

class MemoryStorage {
  private m = new Map<string, string>();
  getItem(k: string) {
    return this.m.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, v);
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
}

describe('storage（07 §7）', () => {
  beforeEach(() => {
    vi.stubGlobal('window', { localStorage: new MemoryStorage(), sessionStorage: new MemoryStorage() });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('chunfeng:mine 最多 200 条，先进先出，去重', () => {
    for (let i = 0; i < MINE_MAX + 5; i++) addMine(`id${i}`);
    const mine = getMine();
    expect(mine).toHaveLength(MINE_MAX);
    expect(mine[0]).toBe('id5');
    expect(isMine('id4')).toBe(false);
    expect(isMine(`id${MINE_MAX + 4}`)).toBe(true);
    addMine('id5');
    expect(getMine().at(-1)).toBe('id5');
    expect(getMine()).toHaveLength(MINE_MAX);
  });

  it('hint-seen 与 draft', () => {
    expect(hasSeenHint()).toBe(false);
    markHintSeen();
    expect(hasSeenHint()).toBe(true);
    expect(getDraft()).toBe('');
    setDraft('要不要');
    expect(getDraft()).toBe('要不要');
    clearDraft();
    expect(getDraft()).toBe('');
  });

  it('存储抛错或内容损坏时静默降级', () => {
    const throwing = {
      getItem() {
        throw new Error('SecurityError');
      },
      setItem() {
        throw new Error('QuotaExceeded');
      },
      removeItem() {
        throw new Error('x');
      },
    };
    vi.stubGlobal('window', { localStorage: throwing, sessionStorage: throwing });
    expect(getMine()).toEqual([]);
    expect(() => addMine('a')).not.toThrow();
    expect(hasSeenHint()).toBe(false);
    expect(() => clearDraft()).not.toThrow();

    const bad = new MemoryStorage();
    bad.setItem(STORAGE_KEYS.mine, '{not json');
    vi.stubGlobal('window', { localStorage: bad, sessionStorage: bad });
    expect(getMine()).toEqual([]);
  });

  it('服务端渲染环境（无 window）', () => {
    vi.unstubAllGlobals();
    expect(getMine()).toEqual([]);
    expect(getDraft()).toBe('');
  });
});
