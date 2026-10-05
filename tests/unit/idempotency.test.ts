import { describe, expect, it, vi } from 'vitest';
import { AppError } from '@/server/http/errors';
import type { GenerateOptionsResult } from '@/server/llm/generateOptions';
import { IdempotencyStore, LruTtlCache, requestFingerprint } from '@/server/reading/idempotency';

const llm = (tag: string): GenerateOptionsResult => ({
  status: 'unclear',
  message: tag,
  meta: { model: 'm', promptVersion: 'v', attempts: 1, semanticAttempts: 1, repaired: false, latencyMs: 1 },
});

describe('inflight 合并', () => {
  it('同一 requestId 并发只执行一次，完成后删除', async () => {
    const store = new IdempotencyStore<string>();
    const fn = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 10));
      return 'done';
    });
    const a = store.run('r1', 'q', fn);
    const b = store.run('r1', 'q', fn);
    expect(store.join('r1', 'q')).toBe(a);
    expect(await Promise.all([a, b])).toEqual(['done', 'done']);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(store.isInflight('r1')).toBe(false);
  });

  it('失败时所有等待者都收到同一个错误，且 inflight 被清除', async () => {
    const store = new IdempotencyStore<string>();
    const a = store.run('r1', 'q', async () => {
      throw new Error('boom');
    });
    const b = store.join('r1', 'q');
    await expect(a).rejects.toThrow('boom');
    await expect(b).rejects.toThrow('boom');
    expect(store.isInflight('r1')).toBe(false);
  });

  it('同一 requestId 但问题不同 → 400', () => {
    const store = new IdempotencyStore<string>();
    void store.run('r1', 'q1', () => new Promise(() => {}));
    expect(() => store.join('r1', 'q2')).toThrow(AppError);
    try {
      store.join('r1', 'q2');
    } catch (e) {
      expect((e as AppError).code).toBe('BAD_REQUEST');
      expect((e as AppError).httpStatus).toBe(400);
    }
  });
});

describe('partialCache', () => {
  it('TTL 15 分钟后过期', () => {
    let t = 0;
    const store = new IdempotencyStore<string>({ now: () => t });
    store.setPartial('r1', 'q', llm('a'));
    t = 15 * 60 * 1000 - 1;
    expect(store.getPartial('r1', 'q')).toMatchObject({ message: 'a' });
    t = 15 * 60 * 1000;
    expect(store.getPartial('r1', 'q')).toBeUndefined();
  });

  it('同一 requestId 但问题不同 → 400', () => {
    const store = new IdempotencyStore<string>();
    store.setPartial('r1', 'q1', llm('a'));
    expect(() => store.getPartial('r1', 'q2')).toThrow(/different question/);
  });

  it('指纹包含图片：同一 requestId 换了图 → 400（15 §7.2）', () => {
    const store = new IdempotencyStore<string>();
    const a = requestFingerprint('q', 'Qm7xK2pT9cHd4Ls8');
    store.setPartial('r1', a, llm('a'));
    expect(store.getPartial('r1', a)).toMatchObject({ message: 'a' });
    expect(() => store.getPartial('r1', requestFingerprint('q', 'Zz7xK2pT9cHd4Ls8'))).toThrow(/different/);
    expect(() => store.getPartial('r1', requestFingerprint('q'))).toThrow(/different/);
    expect(requestFingerprint('q')).toBe(requestFingerprint('q', null));
    expect(requestFingerprint('q')).not.toBe(requestFingerprint('q', 'Qm7xK2pT9cHd4Ls8'));
  });

  it('LRU：超过上限时淘汰最久未使用的', () => {
    const c = new LruTtlCache<number>(3, 1000, () => 0);
    c.set('a', 1);
    c.set('b', 2);
    c.set('c', 3);
    c.get('a'); // a 变为最近使用
    c.set('d', 4);
    expect(c.get('b')).toBeUndefined();
    expect(c.get('a')).toBe(1);
    expect(c.size).toBe(3);
  });

  it('默认上限 500', () => {
    const store = new IdempotencyStore<string>();
    for (let i = 0; i < 501; i++) store.setPartial(`r${i}`, 'q', llm(String(i)));
    expect(store.getPartial('r0', 'q')).toBeUndefined();
    expect(store.getPartial('r500', 'q')).toBeDefined();
  });
});
