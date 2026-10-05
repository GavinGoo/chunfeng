import { describe, expect, it } from 'vitest';
import { RateLimiter } from '@/server/http/rateLimit';

describe('RateLimiter（04 §6）', () => {
  it('每分钟限额：第 9 次被拒绝，并给出 retryAfterMs', () => {
    const t = 0;
    const rl = new RateLimiter(8, 100, () => t);
    for (let i = 0; i < 8; i++) expect(rl.take('ip').ok).toBe(true);
    const d = rl.take('ip');
    expect(d).toEqual({ ok: false, scope: 'min', retryAfterMs: 7500 });
    // 其他 IP 不受影响
    expect(rl.take('other').ok).toBe(true);
  });

  it('到期恢复（匀速回填）', () => {
    let t = 0;
    const rl = new RateLimiter(8, 100, () => t);
    for (let i = 0; i < 8; i++) rl.take('ip');
    t = 7499;
    expect(rl.take('ip').ok).toBe(false);
    t = 7500;
    expect(rl.take('ip').ok).toBe(true);
    expect(rl.take('ip').ok).toBe(false);
    t += 60_000;
    for (let i = 0; i < 8; i++) expect(rl.take('ip').ok).toBe(true);
  });

  it('每日限额', () => {
    let t = 0;
    const rl = new RateLimiter(1000, 5, () => t);
    for (let i = 0; i < 5; i++) expect(rl.take('ip').ok).toBe(true);
    const d = rl.take('ip');
    expect(d.ok).toBe(false);
    if (!d.ok) {
      expect(d.scope).toBe('day');
      expect(d.retryAfterMs).toBe(Math.ceil(86_400_000 / 5));
    }
    t += 86_400_000;
    expect(rl.take('ip').ok).toBe(true);
  });

  it('被拒绝的请求不消耗令牌', () => {
    let t = 0;
    const rl = new RateLimiter(1, 100, () => t);
    expect(rl.take('ip').ok).toBe(true);
    for (let i = 0; i < 5; i++) expect(rl.take('ip').ok).toBe(false);
    t = 60_000;
    expect(rl.take('ip').ok).toBe(true);
  });
});
