// 频率限制（04 §6）：按 ipHash 的进程内令牌桶，分钟与日两个维度。
// 桶容量即限额，按限额 / 周期匀速回填。只有真正发起编排的请求才消耗令牌（幂等重放不计数）。

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;
const SWEEP_THRESHOLD = 10_000;

export type RateScope = 'min' | 'day';

export type RateDecision = { ok: true } | { ok: false; scope: RateScope; retryAfterMs: number };

interface Bucket {
  tokens: number;
  updatedAt: number;
}

interface Entry {
  min: Bucket;
  day: Bucket;
}

export class RateLimiter {
  private readonly entries = new Map<string, Entry>();

  constructor(
    private readonly perMin: number,
    private readonly perDay: number,
    private readonly now: () => number = Date.now,
  ) {}

  private refill(b: Bucket, capacity: number, periodMs: number, t: number): void {
    const elapsed = Math.max(0, t - b.updatedAt);
    b.tokens = Math.min(capacity, b.tokens + (elapsed * capacity) / periodMs);
    b.updatedAt = t;
  }

  private waitMs(b: Bucket, capacity: number, periodMs: number): number {
    return Math.ceil(((1 - b.tokens) * periodMs) / capacity);
  }

  /** 尝试消耗一个令牌 */
  take(key: string): RateDecision {
    const t = this.now();
    let e = this.entries.get(key);
    if (!e) {
      if (this.entries.size >= SWEEP_THRESHOLD) this.sweep(t);
      e = { min: { tokens: this.perMin, updatedAt: t }, day: { tokens: this.perDay, updatedAt: t } };
      this.entries.set(key, e);
    }
    this.refill(e.min, this.perMin, MINUTE_MS, t);
    this.refill(e.day, this.perDay, DAY_MS, t);
    if (e.day.tokens < 1) {
      return { ok: false, scope: 'day', retryAfterMs: this.waitMs(e.day, this.perDay, DAY_MS) };
    }
    if (e.min.tokens < 1) {
      return { ok: false, scope: 'min', retryAfterMs: this.waitMs(e.min, this.perMin, MINUTE_MS) };
    }
    e.min.tokens -= 1;
    e.day.tokens -= 1;
    return { ok: true };
  }

  /** 清理已回满的条目，控制内存 */
  private sweep(t: number): void {
    for (const [k, e] of this.entries) {
      this.refill(e.min, this.perMin, MINUTE_MS, t);
      this.refill(e.day, this.perDay, DAY_MS, t);
      if (e.min.tokens >= this.perMin && e.day.tokens >= this.perDay) this.entries.delete(k);
    }
  }

  get size(): number {
    return this.entries.size;
  }
}
