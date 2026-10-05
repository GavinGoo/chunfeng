import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { resetConfigForTests } from '@/server/config';
import { UpstreamError, upstreamToAppError } from '@/server/http/errors';
import { parseErrorBody } from '@/server/http/fetchWithRetry';
import { buildJevRequest } from '@/server/jev/buildRequest';
import { callJev } from '@/server/jev/client';
import { log } from '@/server/log';

// 真实客户端路径（MOCK_UPSTREAMS=false），用 stub 的全局 fetch 模拟网关响应

const req = buildJevRequest({
  model: 'jev-1.13-free',
  question: '要不要换工作？',
  questionEn: 'Should I change jobs?',
  briefsEn: ['a option', 'b option', 'c option', 'd option'],
});

const prevMock = process.env.MOCK_UPSTREAMS;
beforeAll(() => {
  process.env.MOCK_UPSTREAMS = 'false';
  resetConfigForTests();
});
afterAll(() => {
  process.env.MOCK_UPSTREAMS = prevMock;
  resetConfigForTests();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function gatewayError(status: number, type: string, message: string): Response {
  return new Response(JSON.stringify({ error: { message, type, code: null, param: null } }), {
    status,
    headers: { 'content-type': 'application/json', 'x-request-id': `gw-${status}` },
  });
}

describe('parseErrorBody', () => {
  it('网关的 OpenAI 风格错误体', () => {
    expect(
      parseErrorBody(
        '{"error":{"message":"Upstream request failed: Insufficient account funds","type":"upstream_error","code":null,"param":null}}',
      ),
    ).toEqual({ type: 'upstream_error', message: 'Upstream request failed: Insufficient account funds' });
  });
  it('官方格式与其他常见格式', () => {
    expect(parseErrorBody('{"type":"error","error":"invalid model"}')).toEqual({
      type: 'error',
      message: 'invalid model',
    });
    expect(parseErrorBody('{"message":"Overloaded","type":"overloaded_error"}')).toEqual({
      type: 'overloaded_error',
      message: 'Overloaded',
    });
    expect(parseErrorBody('{"detail":"Unprocessable"}')).toEqual({ message: 'Unprocessable' });
    expect(parseErrorBody('<html>bad gateway</html>')).toEqual({ message: '<html>bad gateway</html>' });
    expect(parseErrorBody('')).toEqual({});
  });
});

describe('callJev 错误处理（03 §7、05 §3.2）', () => {
  it.each([
    [400, 'invalid_request_error', 'the model uses an upstream protocol that opencode2api does not expose'],
    [402, 'upstream_error', 'Upstream request failed: Insufficient account funds'],
  ])('%i 不重试，映射为 SERVICE_MISCONFIGURED，并带 X-Request-Id', async (status, type, message) => {
    const fetchMock = vi.fn(async () => gatewayError(status, type, message));
    vi.stubGlobal('fetch', fetchMock);
    const fatal = vi.spyOn(log(), 'fatal');
    const error = vi.spyOn(log(), 'error');

    const err = await callJev(req, { deadline: Date.now() + 10_000 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UpstreamError);
    const ue = err as UpstreamError;
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(ue.kind).toBe('MISCONFIGURED');
    expect(ue.status).toBe(status);
    expect(ue.upstreamRequestId).toBe(`gw-${status}`);
    expect(ue.upstreamType).toBe(type);
    expect(ue.upstreamMessage).toBe(message);
    expect(upstreamToAppError(ue).code).toBe('SERVICE_MISCONFIGURED');
    expect(upstreamToAppError(ue).retryable).toBe(false);

    const logged = (status === 402 ? fatal : error).mock.calls[0]?.[0] as Record<string, unknown>;
    expect(logged).toMatchObject({ evt: 'upstream.error', status, upstreamRequestId: `gw-${status}` });
    // 日志中绝不出现密钥
    expect(JSON.stringify(logged)).not.toContain(process.env.JEV_API_KEY);
  });

  it('422 时日志带脱敏后的请求体', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => gatewayError(422, 'invalid_request_error', 'bad criteria')),
    );
    const error = vi.spyOn(log(), 'error');
    await expect(callJev(req, { deadline: Date.now() + 10_000 })).rejects.toBeInstanceOf(UpstreamError);
    const rejected = error.mock.calls.find((c) => (c[0] as { evt?: string }).evt === 'jev.request_rejected');
    expect(rejected).toBeDefined();
    const text = JSON.stringify(rejected![0]);
    expect(text).toContain('best_rev');
    expect(text).not.toContain('要不要换工作');
  });

  it('发送 Bearer 鉴权与 JSON 请求体；200 响应经 zod 校验', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string>;
      expect(headers.Authorization).toBe(`Bearer ${process.env.JEV_API_KEY}`);
      expect(JSON.parse(String(init?.body)).model).toBe('jev-1.13-free');
      return Response.json({
        model: 'jev-1.13-free',
        answers: {},
        usage: { input_tokens: 1, output_tokens: 0 },
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const r = await callJev(req, { deadline: Date.now() + 10_000 });
    expect(r.response.model).toBe('jev-1.13-free');
    expect(r.attempts).toBe(1);
  });

  it('200 但响应结构不符 → BAD_OUTPUT（可重试）', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ answers: 'nope' })),
    );
    const err = (await callJev(req, { deadline: Date.now() + 10_000 }).catch(
      (e: unknown) => e,
    )) as UpstreamError;
    expect(err.kind).toBe('BAD_OUTPUT');
    expect(err.retryable).toBe(true);
  });
});
