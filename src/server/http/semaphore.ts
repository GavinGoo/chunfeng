import { AppError } from './errors';

// 并发闸门（04 §2.3 第 5 步）：最多 MAX_CONCURRENT_READINGS 个编排同时进行；排队超时 → 503 BUSY。

export const QUEUE_TIMEOUT_MS = 10_000;
export const BUSY_RETRY_AFTER_MS = 3_000;

type Release = () => void;

interface Waiter {
  grant: (release: Release) => void;
  timer: NodeJS.Timeout;
}

export class Semaphore {
  private active = 0;
  private readonly queue: Waiter[] = [];

  constructor(private readonly max: number) {}

  private makeRelease(): Release {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const next = this.queue.shift();
      if (next) {
        clearTimeout(next.timer);
        next.grant(this.makeRelease());
      } else {
        this.active--;
      }
    };
  }

  /** 获取许可；排队超过 timeoutMs 则抛 BUSY */
  acquire(timeoutMs: number = QUEUE_TIMEOUT_MS): Promise<Release> {
    if (this.active < this.max) {
      this.active++;
      return Promise.resolve(this.makeRelease());
    }
    return new Promise((resolve, reject) => {
      const waiter: Waiter = {
        grant: resolve,
        timer: setTimeout(
          () => {
            const i = this.queue.indexOf(waiter);
            if (i >= 0) this.queue.splice(i, 1);
            reject(
              new AppError('BUSY', 'too many concurrent readings', { retryAfterMs: BUSY_RETRY_AFTER_MS }),
            );
          },
          Math.max(0, timeoutMs),
        ),
      };
      this.queue.push(waiter);
    });
  }

  get inUse(): number {
    return this.active;
  }

  get waiting(): number {
    return this.queue.length;
  }
}
