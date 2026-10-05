import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { POST } from '@/app/api/readings/route';
import { mockStats, resetMockStats } from '@/server/mock/faults';
import { getDb } from '@/server/reading/db';
import { freshIp, postRequest, setupEnv, uuid } from './helpers';

let env: ReturnType<typeof setupEnv>;
beforeAll(() => {
  env = setupEnv({ MOCK_LATENCY_MS: '80' });
});
afterAll(() => env.cleanup());
beforeEach(() => resetMockStats());

describe('幂等与并发', () => {
  it('同一 requestId 并发 5 次：只调用一次上游、只落一条记录、响应相同', async () => {
    const requestId = uuid();
    const ip = freshIp();
    const responses = await Promise.all(
      Array.from({ length: 5 }, () =>
        POST(postRequest({ question: '要不要换工作？', requestId }, { 'x-real-ip': ip })),
      ),
    );
    const bodies = await Promise.all(responses.map((r) => r.json()));
    expect(responses.every((r) => r.status === 200)).toBe(true);
    for (const b of bodies) expect(b).toEqual(bodies[0]);
    expect(mockStats()).toMatchObject({ llmCalls: 1, jevCalls: 1 });
    const n = getDb().prepare('SELECT COUNT(*) AS n FROM readings WHERE request_id = ?').get(requestId) as {
      n: number;
    };
    expect(n.n).toBe(1);
  });

  it('不同 requestId 并发互不影响', async () => {
    const responses = await Promise.all(
      Array.from({ length: 4 }, () =>
        POST(
          postRequest({ question: '周末去海边还是爬山？', requestId: uuid() }, { 'x-real-ip': freshIp() }),
        ),
      ),
    );
    const ids = await Promise.all(
      responses.map(async (r) => ((await r.json()) as { reading: { id: string } }).reading.id),
    );
    expect(new Set(ids).size).toBe(4);
    expect(mockStats().llmCalls).toBe(4);
  });
});
