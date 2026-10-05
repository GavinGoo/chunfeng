import { AppError } from '../http/errors';
import type { GenerateOptionsResult } from '../llm/generateOptions';

// 幂等（04 §2.3 第 3、9 步）：
//  - inflight：同一 requestId 的并发请求合并为同一个 Promise，完成后即删除；
//  - partialCache：缓存 LLM 结果（LRU 500 条、TTL 15 分钟），JEV 失败后重试只需补做 JEV。
// 同一 requestId 但指纹不同 → 400 BAD_REQUEST。
// 指纹 = question + "\n" + (图片 id ?? "")（15 §7.2）：同一 requestId 换了问题或换了图都视为冲突。

export const PARTIAL_CACHE_MAX = 500;
export const PARTIAL_CACHE_TTL_MS = 15 * 60 * 1000;

/** 简单的 LRU + TTL（Map 保持插入顺序，访问时移到队尾） */
export class LruTtlCache<V> {
  private readonly map = new Map<string, { value: V; expiresAt: number }>();

  constructor(
    private readonly max: number,
    private readonly ttlMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  get(key: string): V | undefined {
    const e = this.map.get(key);
    if (!e) return undefined;
    if (e.expiresAt <= this.now()) {
      this.map.delete(key);
      return undefined;
    }
    this.map.delete(key);
    this.map.set(key, e);
    return e.value;
  }

  set(key: string, value: V): void {
    this.map.delete(key);
    this.map.set(key, { value, expiresAt: this.now() + this.ttlMs });
    while (this.map.size > this.max) {
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) break;
      this.map.delete(oldest);
    }
  }

  delete(key: string): void {
    this.map.delete(key);
  }

  get size(): number {
    return this.map.size;
  }
}

/** 幂等比较的对象（15 §7.2 第 3 步）；无图时为 question + "\n" */
export function requestFingerprint(question: string, imageId?: string | null): string {
  return `${question}\n${imageId ?? ''}`;
}

export function mismatchError(): AppError {
  return new AppError('BAD_REQUEST', 'requestId already used for a different question');
}

interface Inflight<T> {
  fingerprint: string;
  promise: Promise<T>;
}

interface PartialEntry {
  fingerprint: string;
  llm: GenerateOptionsResult;
}

export class IdempotencyStore<T> {
  private readonly inflight = new Map<string, Inflight<T>>();
  private readonly partial: LruTtlCache<PartialEntry>;

  constructor(opts: { now?: () => number; max?: number; ttlMs?: number } = {}) {
    this.partial = new LruTtlCache(
      opts.max ?? PARTIAL_CACHE_MAX,
      opts.ttlMs ?? PARTIAL_CACHE_TTL_MS,
      opts.now,
    );
  }

  /** 已有进行中的同一 requestId → 返回同一个 Promise；指纹不同 → 抛 400 */
  join(requestId: string, fingerprint: string): Promise<T> | undefined {
    const f = this.inflight.get(requestId);
    if (!f) return undefined;
    if (f.fingerprint !== fingerprint) throw mismatchError();
    return f.promise;
  }

  /** 登记并执行；调用方须保证 join 与 run 之间没有 await（否则并发请求可能都未命中） */
  run(requestId: string, fingerprint: string, fn: () => Promise<T>): Promise<T> {
    const existing = this.join(requestId, fingerprint);
    if (existing) return existing;
    const promise = (async () => {
      try {
        return await fn();
      } finally {
        this.inflight.delete(requestId);
      }
    })();
    this.inflight.set(requestId, { fingerprint, promise });
    return promise;
  }

  isInflight(requestId: string): boolean {
    return this.inflight.has(requestId);
  }

  /** partialCache 中的 LLM 结果；指纹不同 → 抛 400 */
  getPartial(requestId: string, fingerprint: string): GenerateOptionsResult | undefined {
    const e = this.partial.get(requestId);
    if (!e) return undefined;
    if (e.fingerprint !== fingerprint) throw mismatchError();
    return e.llm;
  }

  setPartial(requestId: string, fingerprint: string, llm: GenerateOptionsResult): void {
    this.partial.set(requestId, { fingerprint, llm });
  }
}
