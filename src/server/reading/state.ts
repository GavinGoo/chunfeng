import type { CreateReadingResponse } from '@/lib/shared/types';
import { getConfig, resetConfigForTests } from '../config';
import { RateLimiter } from '../http/rateLimit';
import { Semaphore } from '../http/semaphore';
import { UPLOAD_CONCURRENCY } from '../image/limits';
import { closeDbForTests } from './db';
import { IdempotencyStore } from './idempotency';

// 进程内状态单例（单实例部署，04 §6）。挂在 globalThis 上，避免开发模式热更新后丢失或重复。

interface ServerState {
  idempotency: IdempotencyStore<CreateReadingResponse>;
  rateLimiter: RateLimiter;
  semaphore: Semaphore;
  /** 上传限流（按 ipHash，与提问限流分开计数）与重编码并发闸门（15 §5.2） */
  uploadRateLimiter: RateLimiter;
  uploadSemaphore: Semaphore;
}

const g = globalThis as typeof globalThis & { __chunfengState?: ServerState };

export function serverState(): ServerState {
  if (!g.__chunfengState) {
    const cfg = getConfig();
    g.__chunfengState = {
      idempotency: new IdempotencyStore<CreateReadingResponse>(),
      rateLimiter: new RateLimiter(cfg.rateLimit.perMin, cfg.rateLimit.perDay),
      semaphore: new Semaphore(cfg.maxConcurrentReadings),
      uploadRateLimiter: new RateLimiter(cfg.uploadRateLimit.perMin, cfg.uploadRateLimit.perDay),
      uploadSemaphore: new Semaphore(UPLOAD_CONCURRENCY),
    };
  }
  return g.__chunfengState;
}

/** 仅测试使用：重置配置、数据库连接与全部内存状态 */
export function resetServerStateForTests(): void {
  g.__chunfengState = undefined;
  closeDbForTests();
  resetConfigForTests();
}
