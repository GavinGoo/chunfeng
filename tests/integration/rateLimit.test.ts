import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mockStats, resetMockStats } from '@/server/mock/faults';
import { post, setupEnv, uuid } from './helpers';

let env: ReturnType<typeof setupEnv>;
beforeAll(() => {
  env = setupEnv({ RATE_LIMIT_PER_MIN: '8', RATE_LIMIT_PER_DAY: '100' });
});
afterAll(() => env.cleanup());

describe('频率限制（04 §9）', () => {
  it('第 9 次/分钟返回 429 且带 retryAfterMs；幂等重放不计数；其他 IP 不受影响', async () => {
    const ip = '203.0.113.7';
    const first = uuid();
    for (let i = 0; i < 8; i++) {
      const r = await post(
        { question: `要不要换工作？第${i}次`, requestId: i === 0 ? first : uuid() },
        { 'x-real-ip': ip },
      );
      expect(r.status).toBe(200);
    }
    // 重放已完成的 requestId：不计数，仍返回 200
    resetMockStats();
    const replay = await post({ question: '要不要换工作？第0次', requestId: first }, { 'x-real-ip': ip });
    expect(replay.status).toBe(200);
    expect(mockStats().llmCalls).toBe(0);

    const ninth = await post({ question: '要不要换工作？第9次', requestId: uuid() }, { 'x-real-ip': ip });
    expect(ninth.status).toBe(429);
    expect(ninth.json).toMatchObject({ error: { code: 'RATE_LIMITED', retryable: true } });
    const retryAfterMs = (ninth.json.error as { retryAfterMs: number }).retryAfterMs;
    expect(retryAfterMs).toBeGreaterThan(0);
    expect(retryAfterMs).toBeLessThanOrEqual(7500);
    expect(Number(ninth.res.headers.get('retry-after'))).toBeGreaterThanOrEqual(1);
    expect(mockStats().llmCalls).toBe(0);

    // X-Forwarded-For 第一跳作为回退
    const other = await post(
      { question: '要不要换工作？', requestId: uuid() },
      { 'x-real-ip': '', 'x-forwarded-for': '198.51.100.1, 10.0.0.1' },
    );
    expect(other.status).toBe(200);
  });
});
