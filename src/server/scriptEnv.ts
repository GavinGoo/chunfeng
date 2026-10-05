import { existsSync } from 'node:fs';

// 供 scripts/*.ts（tsx 运行）使用：tsx 不会自动加载 .env。
// 只加载变量，绝不打印任何值。已存在的环境变量不会被覆盖。

export function loadScriptEnv(file = '.env'): boolean {
  if (!existsSync(file)) return false;
  const loader = (process as { loadEnvFile?: (path?: string) => void }).loadEnvFile;
  if (typeof loader !== 'function') return false;
  loader(file);
  return true;
}

export interface ScriptArgs {
  limit?: number;
  repeat?: number;
  mock: boolean;
  concurrency: number;
}

/** 解析 --limit N --repeat N --mock --concurrency N */
export function parseScriptArgs(argv: readonly string[]): ScriptArgs {
  const out: ScriptArgs = { mock: false, concurrency: 2 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const n = Number(argv[++i]);
      if (!Number.isInteger(n) || n <= 0) throw new Error(`参数 ${a} 需要正整数`);
      return n;
    };
    if (a === '--limit') out.limit = next();
    else if (a === '--repeat') out.repeat = next();
    else if (a === '--concurrency') out.concurrency = next();
    else if (a === '--mock') out.mock = true;
  }
  return out;
}

/** 从文本中抹去所有密钥值（防御性：上游报错偶尔会回显请求内容） */
export function scrubSecrets(text: string, env: Record<string, string | undefined> = process.env): string {
  let out = text;
  for (const k of ['JEV_API_KEY', 'LLM_API_KEY', 'IP_HASH_SALT']) {
    const v = env[k];
    if (v && v.length >= 4) out = out.split(v).join('[redacted]');
  }
  return out;
}

export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (x: T, i: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]!, i);
    }
  });
  await Promise.all(workers);
  return results;
}

export function quantile(xs: readonly number[], q: number): number {
  if (xs.length === 0) return Number.NaN;
  const s = [...xs].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo]! + (s[hi]! - s[lo]!) * (pos - lo);
}

export const fmt = (x: number, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : '—');

export function today(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
