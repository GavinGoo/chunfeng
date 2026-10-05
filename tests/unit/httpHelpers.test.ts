import { describe, expect, it } from 'vitest';
import { isReadingId, pageNoFromId } from '@/lib/shared/ids';
import { graphemeLength, isQuestionLengthValid, normalizeQuestion } from '@/lib/shared/question';
import { MAX_BODY_BYTES, readBodyLimited } from '@/server/http/body';
import { clientIp, hashIp } from '@/server/http/clientIp';
import { AppError, errorBody, errorResponse, toAppError, UpstreamError } from '@/server/http/errors';
import { isOriginAllowed, isSameSiteRequest, requestBaseUrl } from '@/server/http/origin';
import { Semaphore } from '@/server/http/semaphore';
import { newReadingId } from '@/server/reading/service';

describe('clientIp / hashIp', () => {
  it('优先 X-Real-IP，其次 X-Forwarded-For 第一跳，最后 unknown', () => {
    expect(clientIp(new Headers({ 'x-real-ip': '1.2.3.4', 'x-forwarded-for': '5.6.7.8' }))).toBe('1.2.3.4');
    expect(clientIp(new Headers({ 'x-forwarded-for': ' 5.6.7.8 , 10.0.0.1' }))).toBe('5.6.7.8');
    expect(clientIp(new Headers())).toBe('unknown');
  });

  it('sha256(salt+ip) 前 32 位十六进制，不含明文', () => {
    const h = hashIp('1.2.3.4', 'salt');
    expect(h).toMatch(/^[0-9a-f]{32}$/);
    expect(h).toBe(hashIp('1.2.3.4', 'salt'));
    expect(h).not.toBe(hashIp('1.2.3.4', 'other'));
  });
});

describe('isOriginAllowed（D45）', () => {
  it('Origin 缺失放行；Origin 的 host 与请求 Host 一致才放行', () => {
    expect(isOriginAllowed(new Headers())).toBe(true);
    expect(isOriginAllowed(new Headers({ origin: '' }))).toBe(true);
    const h = (origin: string, host: string) => new Headers({ origin, host });
    expect(isOriginAllowed(h('https://chunfeng.example', 'chunfeng.example'))).toBe(true);
    expect(isOriginAllowed(h('http://192.168.1.5:3000', '192.168.1.5:3000'))).toBe(true);
    expect(isOriginAllowed(h('https://Chunfeng.Example', 'CHUNFENG.example'))).toBe(true); // 大小写不敏感
    expect(isOriginAllowed(h('https://chunfeng.example:443', 'chunfeng.example'))).toBe(true); // 默认端口
    expect(isOriginAllowed(h('https://evil.example', 'chunfeng.example'))).toBe(false);
    expect(isOriginAllowed(h('https://chunfeng.example:8443', 'chunfeng.example'))).toBe(false); // 端口不同
    expect(isOriginAllowed(h('null', 'chunfeng.example'))).toBe(false);
    expect(isOriginAllowed(h('file://', ''))).toBe(false);
  });

  it('多个域名反代到同一后端：各自同源都放行，互相跨域不放行', () => {
    for (const host of ['a.example', 'b.example']) {
      expect(isOriginAllowed(new Headers({ origin: `https://${host}`, host }))).toBe(true);
    }
    expect(isOriginAllowed(new Headers({ origin: 'https://a.example', host: 'b.example' }))).toBe(false);
  });

  it('优先 X-Forwarded-Host（第一个值）；有 Origin 而没有 Host 时拒绝', () => {
    const proxied = { 'x-forwarded-host': 'b.example, inner.example', host: '127.0.0.1:3000' };
    expect(isOriginAllowed(new Headers({ ...proxied, origin: 'https://b.example' }))).toBe(true);
    expect(isOriginAllowed(new Headers({ ...proxied, origin: 'http://127.0.0.1:3000' }))).toBe(false);
    expect(isOriginAllowed(new Headers({ origin: 'https://chunfeng.example' }))).toBe(false);
  });
});

describe('requestBaseUrl', () => {
  it('优先 X-Forwarded-Host / X-Forwarded-Proto（取第一个值）', () => {
    const h = new Headers({
      'x-forwarded-host': ' book.example , inner.example',
      'x-forwarded-proto': 'https, http',
      host: '127.0.0.1:3000',
    });
    expect(requestBaseUrl(h)).toBe('https://book.example');
  });

  it('没有 X-Forwarded-* 时用 Host，协议按 http（前面没有代理）', () => {
    expect(requestBaseUrl(new Headers({ host: '192.168.1.5:3000' }))).toBe('http://192.168.1.5:3000');
    expect(requestBaseUrl(new Headers({ host: '[::1]:3000' }))).toBe('http://[::1]:3000');
    expect(requestBaseUrl(new Headers({ host: 'book.example', 'x-forwarded-proto': 'HTTPS' }))).toBe(
      'https://book.example',
    );
    expect(requestBaseUrl(new Headers({ host: 'book.example', 'x-forwarded-proto': 'ftp' }))).toBe(
      'http://book.example',
    );
  });

  it('域名缺失或非法时返回 null', () => {
    expect(requestBaseUrl(new Headers())).toBeNull();
    for (const host of ['evil.example/a', 'evil.example?x', 'a b', ':3000', 'http://evil']) {
      expect(requestBaseUrl(new Headers({ host }))).toBeNull();
    }
  });
});

describe('isSameSiteRequest', () => {
  it('Sec-Fetch-Site 决定：只有 same-origin 算本站', () => {
    for (const [site, want] of [
      ['same-origin', true],
      ['same-site', false],
      ['cross-site', false],
      ['none', false],
    ] as const) {
      expect(isSameSiteRequest(new Headers({ 'sec-fetch-site': site, host: 'book.example' }))).toBe(want);
    }
  });

  it('没有 Sec-Fetch-Site 时看 Referer 的 host 是否与请求 Host 一致', () => {
    expect(
      isSameSiteRequest(new Headers({ referer: 'https://book.example/a/abc', host: 'book.example' })),
    ).toBe(true);
    expect(
      isSameSiteRequest(
        new Headers({ referer: 'https://book.example/a/abc', 'x-forwarded-host': 'book.example' }),
      ),
    ).toBe(true);
    expect(isSameSiteRequest(new Headers({ referer: 'https://evil.example/', host: 'book.example' }))).toBe(
      false,
    );
    expect(isSameSiteRequest(new Headers({ referer: 'not a url', host: 'book.example' }))).toBe(false);
    expect(isSameSiteRequest(new Headers({ host: 'book.example' }))).toBe(false); // 爬虫：都没有
  });
});

describe('readBodyLimited', () => {
  it('≤ 4 KB 正常读取；超出 → 413', async () => {
    const ok = new Request('http://x', { method: 'POST', body: 'a'.repeat(MAX_BODY_BYTES) });
    expect(await readBodyLimited(ok)).toHaveLength(MAX_BODY_BYTES);
    const big = new Request('http://x', { method: 'POST', body: 'a'.repeat(MAX_BODY_BYTES + 1) });
    await expect(readBodyLimited(big)).rejects.toMatchObject({ code: 'PAYLOAD_TOO_LARGE' });
    // 按字节计：多字节字符
    const zh = new Request('http://x', { method: 'POST', body: '字'.repeat(1400) });
    await expect(readBodyLimited(zh)).rejects.toMatchObject({ code: 'PAYLOAD_TOO_LARGE' });
  });
});

describe('errors', () => {
  it('429 / 503 带 Retry-After 响应头；响应体不含堆栈', async () => {
    const res = errorResponse(new AppError('RATE_LIMITED', 'x', { retryAfterMs: 7500 }), 'rid');
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('8');
    expect(await res.json()).toEqual({
      error: { code: 'RATE_LIMITED', message: 'x', retryable: true, retryAfterMs: 7500, requestId: 'rid' },
    });
    const internal = errorBody(toAppError(new Error('secret stack')));
    expect(JSON.stringify(internal)).not.toContain('secret');
    expect(internal.error.code).toBe('INTERNAL');
  });

  it('上游错误映射（05 §2）', () => {
    const map = (init: ConstructorParameters<typeof UpstreamError>[0]) =>
      toAppError(new UpstreamError(init)).code;
    expect(map({ source: 'llm', kind: 'HTTP', retryable: true, status: 503 })).toBe('LLM_UNAVAILABLE');
    expect(map({ source: 'llm', kind: 'BAD_OUTPUT', retryable: true })).toBe('LLM_BAD_OUTPUT');
    expect(map({ source: 'jev', kind: 'NETWORK', retryable: true })).toBe('JEV_UNAVAILABLE');
    expect(map({ source: 'jev', kind: 'TIMEOUT', retryable: true })).toBe('UPSTREAM_TIMEOUT');
    expect(map({ source: 'llm', kind: 'MISCONFIGURED', retryable: false, status: 401 })).toBe(
      'SERVICE_MISCONFIGURED',
    );
  });
});

describe('Semaphore', () => {
  it('超过上限时排队，释放后依次放行；排队超时 → BUSY', async () => {
    const s = new Semaphore(1);
    const r1 = await s.acquire(1000);
    const p2 = s.acquire(1000);
    const p3 = s.acquire(10);
    expect(s.waiting).toBe(2);
    await expect(p3).rejects.toMatchObject({ code: 'BUSY', httpStatus: 503 });
    r1();
    const r2 = await p2;
    expect(s.inUse).toBe(1);
    r2();
    r2(); // 重复释放无副作用
    expect(s.inUse).toBe(0);
  });
});

describe('ids / question', () => {
  it('nanoid(12) 满足 READING_ID_RE；页码 100–999', () => {
    for (let i = 0; i < 200; i++) {
      const id = newReadingId();
      expect(isReadingId(id)).toBe(true);
      const p = pageNoFromId(id);
      expect(p).toBeGreaterThanOrEqual(100);
      expect(p).toBeLessThanOrEqual(999);
    }
    expect(isReadingId('short')).toBe(false);
    expect(isReadingId('abc/../../xx')).toBe(false);
  });

  it('规范化：去零宽与控制字符、合并空白；按字素簇计数', () => {
    expect(normalizeQuestion('  要不要​换\n\n工作\u0007？ ')).toBe('要不要换 工作？');
    expect(graphemeLength('👨‍👩‍👧好')).toBe(2);
    expect(isQuestionLengthValid('好')).toBe(false);
    expect(isQuestionLengthValid('好的')).toBe(true);
    expect(isQuestionLengthValid('字'.repeat(201))).toBe(false);
  });
});
