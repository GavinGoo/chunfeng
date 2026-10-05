import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { POST } from '@/app/api/readings/route';
import { mockStats, resetMockStats, setMockFail } from '@/server/mock/faults';
import { serverState } from '@/server/reading/state';
import { freshIp, post, postRequest, setupEnv, uuid } from './helpers';

// 05 §8：任何情况下，服务端总耗时不超过 READING_DEADLINE_MS + 1 s；并发闸门排队超时 → BUSY

const DEADLINE = 1500;
let env: ReturnType<typeof setupEnv>;
beforeAll(() => {
  env = setupEnv({
    READING_DEADLINE_MS: String(DEADLINE),
    MAX_CONCURRENT_READINGS: '1',
    MOCK_LATENCY_MS: '5',
  });
});
afterAll(() => env.cleanup());

describe('共享 deadline', () => {
  it('llm:timeout:1（上游挂起）→ UPSTREAM_TIMEOUT，总耗时 ≤ deadline + 1 s', async () => {
    setMockFail('llm:timeout:1');
    resetMockStats();
    const started = Date.now();
    const r = await post({ question: '要不要换工作？', requestId: uuid() }, { 'x-real-ip': freshIp() });
    const elapsed = Date.now() - started;
    expect(r.status).toBe(504);
    expect(r.json).toMatchObject({ error: { code: 'UPSTREAM_TIMEOUT', retryable: true } });
    expect(elapsed).toBeLessThanOrEqual(DEADLINE + 1000);
    expect(mockStats().llmCalls).toBe(1);
    setMockFail('');
  });

  it('并发闸门已满且排队超时 → 503 BUSY（带 Retry-After）', async () => {
    setMockFail('llm:timeout:1'); // 第一个请求占住唯一的许可直到 deadline
    const slow = POST(
      postRequest({ question: '要不要换工作？', requestId: uuid() }, { 'x-real-ip': freshIp() }),
    );
    // 等第一个请求真正拿到唯一的许可（负载高时固定延时不可靠）
    for (let i = 0; i < 200 && serverState().semaphore.inUse < 1; i++)
      await new Promise((r) => setTimeout(r, 5));
    expect(serverState().semaphore.inUse).toBe(1);
    const busy = await post({ question: '要不要养猫？', requestId: uuid() }, { 'x-real-ip': freshIp() });
    expect(busy.status).toBe(503);
    expect(busy.json).toMatchObject({ error: { code: 'BUSY', retryable: true } });
    expect(busy.res.headers.get('retry-after')).toBe('3');
    expect((await slow).status).toBe(504);
    setMockFail('');
  });
});
