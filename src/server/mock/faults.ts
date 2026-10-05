// 模拟上游的故障注入（02 §10、03 §4、05 §8）。
// 格式：MOCK_FAIL=来源:类型:次数[:Retry-After 秒]，多条用逗号分隔。
//   来源：llm | jev
//   类型：HTTP 状态码（如 503）| empty | schema | length | badjson | network | timeout（仅 llm 语义类有意义）| bad（jev 答案缺失）
//        | filter（llm 风控拦截的 400）| novision（llm 不接受图片的 400）（15 §8.5）
// 例：MOCK_FAIL=llm:503:2,jev:429:1:30

export interface FaultRule {
  source: 'llm' | 'jev';
  kind: string;
  count: number;
  retryAfterSec?: number;
}

export function parseFaultSpec(spec: string): FaultRule[] {
  return spec
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .flatMap((s) => {
      const [source, kind, count, ra] = s.split(':');
      if ((source !== 'llm' && source !== 'jev') || !kind) return [];
      const n = Number(count ?? 1);
      return [
        {
          source,
          kind,
          count: Number.isFinite(n) ? n : 1,
          retryAfterSec: ra !== undefined && ra !== '' ? Number(ra) : undefined,
        } satisfies FaultRule,
      ];
    });
}

export interface MockStats {
  llmCalls: number;
  jevCalls: number;
  llmRepairCalls: number;
  /** 带图提问（15 §16.2）：LLM 收到图片部件的次数；JEV 的 state 含 image 的次数 */
  llmImageCalls: number;
  jevImageCalls: number;
}

const emptyStats = (): MockStats => ({
  llmCalls: 0,
  jevCalls: 0,
  llmRepairCalls: 0,
  llmImageCalls: 0,
  jevImageCalls: 0,
});

interface MockState {
  spec: string;
  rules: FaultRule[];
  used: Map<FaultRule, number>;
  stats: MockStats;
  override?: string;
}

const g = globalThis as typeof globalThis & { __chunfengMock?: MockState };

function state(envSpec: string): MockState {
  const spec = g.__chunfengMock?.override ?? envSpec;
  if (!g.__chunfengMock || g.__chunfengMock.spec !== spec) {
    g.__chunfengMock = {
      spec,
      rules: parseFaultSpec(spec),
      used: new Map(),
      stats: g.__chunfengMock?.stats ?? emptyStats(),
      override: g.__chunfengMock?.override,
    };
  }
  return g.__chunfengMock;
}

/** 取出本次调用应触发的故障（每条规则按次数消耗） */
export function takeFault(source: 'llm' | 'jev', envSpec: string): FaultRule | undefined {
  const s = state(envSpec);
  for (const rule of s.rules) {
    if (rule.source !== source) continue;
    const used = s.used.get(rule) ?? 0;
    if (used < rule.count) {
      s.used.set(rule, used + 1);
      return rule;
    }
  }
  return undefined;
}

export function mockStats(envSpec = ''): MockState['stats'] {
  return state(envSpec).stats;
}

/** 测试用：覆盖故障规格（传 undefined 恢复为 env），并重置计数 */
export function setMockFail(spec: string | undefined): void {
  const stats = g.__chunfengMock?.stats ?? emptyStats();
  g.__chunfengMock = { spec: '\u0000', rules: [], used: new Map(), stats, override: spec };
}

export function resetMockStats(): void {
  const s = g.__chunfengMock;
  if (s) s.stats = emptyStats();
}

export function mockDelay(ms: number, signal?: AbortSignal | null): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}

export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/** 确定性伪随机（mulberry32） */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function faultResponse(rule: FaultRule, source: 'llm' | 'jev'): Response | null {
  const status = Number(rule.kind);
  if (!Number.isInteger(status)) return null;
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-request-id': `mock-${source}-${Date.now().toString(36)}`,
  };
  if (rule.retryAfterSec !== undefined) headers['retry-after'] = String(rule.retryAfterSec);
  const type = status === 402 ? 'upstream_error' : status >= 500 ? 'server_error' : 'invalid_request_error';
  return new Response(
    JSON.stringify({ error: { message: `mock ${status}`, type, code: null, param: null } }),
    {
      status,
      headers,
    },
  );
}
