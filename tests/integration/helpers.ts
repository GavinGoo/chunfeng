import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GET as getReading } from '@/app/api/readings/[id]/route';
import { POST as postReading } from '@/app/api/readings/route';
import { resetMockStats, setMockFail } from '@/server/mock/faults';
import { resetServerStateForTests } from '@/server/reading/state';

// 集成测试公共设施：临时数据库文件 + 模拟上游，直接调用 Route Handler。

export const BASE = 'http://localhost:3000';
/** 与 BASE 对应的 Host：浏览器请求必带它，Origin 校验与分享图域名都以它为准（D45） */
export const HOST = 'localhost:3000';

export function setupEnv(overrides: Record<string, string> = {}): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'chunfeng-it-'));
  const env: Record<string, string> = {
    MOCK_UPSTREAMS: 'true',
    MOCK_LATENCY_MS: '5',
    MOCK_FAIL: '',
    DATABASE_PATH: join(dir, 'test.db'),
    SHARE_CACHE_DIR: join(dir, 'share-cache'),
    RATE_LIMIT_PER_MIN: '1000',
    RATE_LIMIT_PER_DAY: '10000',
    READING_DEADLINE_MS: '50000',
    MAX_CONCURRENT_READINGS: '16',
    ...overrides,
  };
  Object.assign(process.env, env);
  resetServerStateForTests();
  setMockFail('');
  resetMockStats();
  return {
    dir,
    cleanup: () => {
      resetServerStateForTests();
      setMockFail(undefined);
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

let ipCounter = 0;
/** 每个用例使用不同的 IP，避免限流互相影响 */
export function freshIp(): string {
  ipCounter++;
  return `10.0.${Math.floor(ipCounter / 250)}.${ipCounter % 250}`;
}

export function uuid(): string {
  return crypto.randomUUID();
}

export function postRequest(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`${BASE}/api/readings`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: BASE,
      host: HOST,
      'x-real-ip': '10.9.9.9',
      ...headers,
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

export async function post(
  body: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; json: Record<string, unknown>; res: Response }> {
  const res = await postReading(postRequest(body, headers));
  return { status: res.status, json: (await res.json()) as Record<string, unknown>, res };
}

export async function get(
  id: string,
): Promise<{ status: number; json: Record<string, unknown>; res: Response }> {
  const res = await getReading(new Request(`${BASE}/api/readings/${id}`), {
    params: Promise.resolve({ id }),
  });
  return { status: res.status, json: (await res.json()) as Record<string, unknown>, res };
}
