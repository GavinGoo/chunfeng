import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Reading } from '@/lib/shared/types';
import { log } from '@/server/log';
import { mockStats, resetMockStats, setMockFail } from '@/server/mock/faults';
import { freshIp, post, setupEnv, uuid } from './helpers';

// 05 §8 的全部 Mock 故障注入场景

let env: ReturnType<typeof setupEnv>;
beforeAll(() => {
  env = setupEnv();
});
afterAll(() => env.cleanup());
beforeEach(() => {
  setMockFail('');
  resetMockStats();
});
afterEach(() => vi.restoreAllMocks());

const ask = (requestId = uuid(), question = '要不要换工作？', ip = freshIp()) =>
  post({ question, requestId }, { 'x-real-ip': ip });

describe('LLM 故障', () => {
  it('llm:503:2 → 第 3 次尝试成功', async () => {
    setMockFail('llm:503:2');
    const r = await ask();
    expect(r.status).toBe(200);
    expect(mockStats().llmCalls).toBe(3);
  });

  it('llm:empty:1 → 语义重试 1 次后成功', async () => {
    setMockFail('llm:empty:1');
    const r = await ask();
    expect(r.status).toBe(200);
    expect(mockStats()).toMatchObject({ llmCalls: 2, llmRepairCalls: 0 });
  });

  it('llm:schema:1 → 第 2 次使用修复消息', async () => {
    setMockFail('llm:schema:1');
    const r = await ask();
    expect(r.status).toBe(200);
    expect(mockStats()).toMatchObject({ llmCalls: 2, llmRepairCalls: 1 });
  });

  it('llm:length:1 / llm:badjson:1 → 重新采样后成功', async () => {
    setMockFail('llm:length:1,llm:badjson:1');
    const r = await ask();
    expect(r.status).toBe(200);
    expect(mockStats()).toMatchObject({ llmCalls: 3, llmRepairCalls: 0 });
  });

  it('llm:schema:3 → LLM_BAD_OUTPUT（502，可重试）', async () => {
    setMockFail('llm:schema:3');
    const r = await ask();
    expect(r.status).toBe(502);
    expect(r.json).toMatchObject({ error: { code: 'LLM_BAD_OUTPUT', retryable: true } });
    expect(mockStats().jevCalls).toBe(0);
  });

  it('llm:401:1 → SERVICE_MISCONFIGURED，日志出现 fatal，不可重试', async () => {
    setMockFail('llm:401:1');
    const fatal = vi.spyOn(log(), 'fatal');
    const r = await ask();
    expect(r.status).toBe(503);
    expect(r.json).toMatchObject({ error: { code: 'SERVICE_MISCONFIGURED', retryable: false } });
    expect(mockStats().llmCalls).toBe(1);
    expect(fatal).toHaveBeenCalled();
    expect(fatal.mock.calls[0]![0]).toMatchObject({ evt: 'upstream.error', source: 'llm', status: 401 });
    // 响应体不泄露上游原始报文
    expect(JSON.stringify(r.json)).not.toContain('mock 401');
  });

  it('llm:network:3 → LLM_UNAVAILABLE', async () => {
    setMockFail('llm:network:3');
    const r = await ask();
    expect(r.status).toBe(502);
    expect(r.json).toMatchObject({ error: { code: 'LLM_UNAVAILABLE', retryable: true } });
  });
});

describe('JEV 故障', () => {
  it('jev:529:9 → JEV_UNAVAILABLE；清除故障后同一 requestId 重试，LLM 不再被调用', async () => {
    setMockFail('jev:529:9');
    const requestId = uuid();
    const ip = freshIp();
    const first = await ask(requestId, '要不要换工作？', ip);
    expect(first.status).toBe(502);
    expect(first.json).toMatchObject({ error: { code: 'JEV_UNAVAILABLE', retryable: true, requestId } });
    expect(mockStats()).toMatchObject({ llmCalls: 1, jevCalls: 4 });

    setMockFail('');
    resetMockStats();
    const retry = await ask(requestId, '要不要换工作？', ip);
    expect(retry.status).toBe(200);
    expect((retry.json.reading as Reading).options).toHaveLength(4);
    expect(mockStats()).toMatchObject({ llmCalls: 0, jevCalls: 1 });
  });

  it('jev:402:1 → 不重试，SERVICE_MISCONFIGURED，fatal 日志带 X-Request-Id', async () => {
    setMockFail('jev:402:1');
    const fatal = vi.spyOn(log(), 'fatal');
    const r = await ask();
    expect(r.status).toBe(503);
    expect(r.json).toMatchObject({ error: { code: 'SERVICE_MISCONFIGURED', retryable: false } });
    expect(mockStats().jevCalls).toBe(1);
    const fields = fatal.mock.calls[0]![0] as Record<string, unknown>;
    expect(fields).toMatchObject({
      evt: 'upstream.error',
      source: 'jev',
      status: 402,
      upstreamType: 'upstream_error',
    });
    expect(fields.upstreamRequestId).toMatch(/^mock-jev-/);
  });

  it('jev:400:1（模型不可路由）→ 不重试，SERVICE_MISCONFIGURED', async () => {
    setMockFail('jev:400:1');
    const r = await ask();
    expect(r.status).toBe(503);
    expect(r.json).toMatchObject({ error: { code: 'SERVICE_MISCONFIGURED' } });
    expect(mockStats().jevCalls).toBe(1);
  });

  it('jev:429:1:30（Retry-After 30 s 超过上限 10 s）→ 不等待，透传 retryAfterMs 供前端倒计时', async () => {
    setMockFail('jev:429:1:30');
    const started = Date.now();
    const r = await ask();
    expect(Date.now() - started).toBeLessThan(2000);
    expect(r.status).toBe(502);
    expect(r.json).toMatchObject({
      error: { code: 'JEV_UNAVAILABLE', retryable: true, retryAfterMs: 30_000 },
    });
    expect(mockStats().jevCalls).toBe(1);
  });

  it('jev:bad:1（答案缺失）→ 再请求 1 次后成功', async () => {
    setMockFail('jev:bad:1');
    const r = await ask();
    expect(r.status).toBe(200);
    expect(mockStats().jevCalls).toBe(2);
  });

  it('jev:bad:2 → JEV_UNAVAILABLE', async () => {
    setMockFail('jev:bad:2');
    const r = await ask();
    expect(r.status).toBe(502);
    expect(r.json).toMatchObject({ error: { code: 'JEV_UNAVAILABLE' } });
  });
});
