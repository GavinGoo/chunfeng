import { describe, expect, it } from 'vitest';
import { type Flight, FlipScheduler } from '@/components/flip/scheduler';

function seeded(seed = 1) {
  let a = seed;
  return () => {
    a = (a * 1664525 + 1013904223) % 4294967296;
    return a / 4294967296;
  };
}

function setup(seed = 1) {
  const log = {
    started: [] as Array<{ f: Flight; at: number }>,
    landed: [] as Array<{ f: Flight; at: number }>,
  };
  let now = 0;
  const s = new FlipScheduler(
    {
      onStart: (f) => log.started.push({ f, at: now }),
      onLand: (f) => log.landed.push({ f, at: now }),
    },
    { random: seeded(seed) },
  );
  let maxInAir = 0;
  const advance = (to: number, step = 16) => {
    while (now < to) {
      now = Math.min(to, now + step);
      s.tick(now);
      maxInAir = Math.max(maxInAir, s.inAir.length);
    }
  };
  return {
    s,
    log,
    advance,
    get now() {
      return now;
    },
    set now(v: number) {
      now = v;
    },
    get maxInAir() {
      return maxInAir;
    },
  };
}

describe('FlipScheduler', () => {
  it('结果 0.3 s 到达：仍翻够最短时长与最少页数，最后一页落下后才 resolve', async () => {
    const h = setup();
    h.s.start(0);
    h.advance(300);
    let done = false;
    let doneAt = -1;
    void h.s.stop(h.now).then(() => {
      done = true;
    });
    for (let t = 300; t < 10_000 && !done; t += 16) {
      h.advance(t + 16);
      await Promise.resolve();
      if (done && doneAt < 0) doneAt = h.now;
    }
    expect(done).toBe(true);
    const regular = h.log.started.filter((e) => !e.f.final);
    const finals = h.log.started.filter((e) => e.f.final);
    expect(regular.length).toBeGreaterThanOrEqual(3);
    expect(finals).toHaveLength(1);
    // 最后一页在最短循环时长之后才起翻，且此时空中已无其他页
    const finalStart = finals[0]!.at;
    expect(finalStart).toBeGreaterThanOrEqual(2400);
    const lastRegularLand = Math.max(...h.log.landed.filter((e) => !e.f.final).map((e) => e.at));
    expect(finalStart).toBeGreaterThanOrEqual(lastRegularLand);
    // 最后一页 1200 ms，落下后 resolve
    const finalLand = h.log.landed.find((e) => e.f.final)!.at;
    expect(finalLand - finalStart).toBeGreaterThanOrEqual(1200);
    expect(doneAt).toBeGreaterThanOrEqual(finalLand);
    expect(h.s.phase).toBe('settled');
    expect(h.s.inAir).toHaveLength(0);
    // 满足最短时长后不再起新的常规页
    expect(regular.every((e) => e.at <= 2400)).toBe(true);
  });

  it('自定义 minLoopMs / minPages', async () => {
    const h = setup();
    h.s.start(0);
    const p = h.s.stop(0, { minLoopMs: 0, minPages: 5 });
    let done = false;
    void p.then(() => {
      done = true;
    });
    h.advance(8000);
    await Promise.resolve();
    expect(done).toBe(true);
    expect(h.log.started.filter((e) => !e.f.final)).toHaveLength(5);
  });

  it('第一页 1000 ms，稳定节奏约 760 / 420 ms，同时在空中不超过 3 页', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const h = setup(seed);
      h.s.start(0);
      h.advance(30_000);
      expect(h.maxInAir).toBeLessThanOrEqual(3);
      expect(h.maxInAir).toBeGreaterThanOrEqual(2);
      const first = h.log.started[0]!.f;
      expect(first.duration).toBe(1000);
      const rest = h.log.started.slice(1).map((e) => e.f);
      for (const f of rest) {
        expect(f.duration).toBeGreaterThanOrEqual(760 * 0.85 - 1e-9);
        expect(f.theta0).toBeGreaterThanOrEqual(0.12);
        expect(f.theta0).toBeLessThanOrEqual(0.26);
        expect(f.rMaxRatio).toBeGreaterThanOrEqual(0.18);
        expect(f.rMaxRatio).toBeLessThanOrEqual(0.28);
      }
      // 30 s 内大约 70 页（420 ms 间隔）
      expect(h.log.started.length).toBeGreaterThan(60);
      expect(h.log.started.length).toBeLessThan(80);
    }
  });

  it('按起翻顺序落下，后翻的页不会追上先翻的页', () => {
    const h = setup(7);
    h.s.start(0);
    h.advance(20_000, 5);
    const order = h.log.landed.map((e) => e.f.seq);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it('页面隐藏期间暂停；返回时若已请求收尾，直接落下空中的页，不补播', async () => {
    const h = setup();
    h.s.start(0);
    h.advance(1000);
    h.s.pause(1000);
    const startedBefore = h.log.started.length;
    let done = false;
    void h.s.stop(5000).then(() => {
      done = true;
    });
    // 隐藏期间 tick 不产生任何新页
    h.now = 20_000;
    h.s.tick(20_000);
    expect(h.log.started.length).toBe(startedBefore);
    h.s.resume(30_000);
    h.now = 30_000;
    // 空中的页立即落下，只起一页收尾页
    expect(h.log.landed.length).toBe(startedBefore);
    expect(h.log.started.length).toBe(startedBefore + 1);
    expect(h.log.started.at(-1)!.f.final).toBe(true);
    h.advance(31_300);
    await Promise.resolve();
    expect(done).toBe(true);
    expect(h.log.started.length).toBe(startedBefore + 1);
  });

  it('页面隐藏期间未请求收尾：返回后从暂停处继续，没有一连串补播', () => {
    const h = setup();
    h.s.start(0);
    h.advance(1000);
    const inAirBefore = h.s.inAir.map((f) => [f.seq, f.t]);
    h.s.pause(1000);
    const startedBefore = h.log.started.length;
    h.s.resume(60_000);
    h.now = 60_000;
    h.s.tick(60_000);
    expect(h.s.inAir.map((f) => [f.seq, f.t])).toEqual(inAirBefore);
    h.advance(60_500);
    expect(h.log.started.length).toBeLessThanOrEqual(startedBefore + 2);
  });

  it('flipOnce：只翻一页，落在空白纸上后 resolve', async () => {
    const h = setup();
    let done = false;
    void h.s.flipOnce(0).then(() => {
      done = true;
    });
    h.advance(1100);
    await Promise.resolve();
    expect(done).toBe(false);
    h.advance(1300);
    await Promise.resolve();
    expect(done).toBe(true);
    expect(h.log.started).toHaveLength(1);
    expect(h.log.started[0]!.f.final).toBe(true);
  });

  it('未开始或已收尾时 stop 立即 resolve；可以再次 start（再翻一次）', async () => {
    const h = setup();
    await expect(h.s.stop(0)).resolves.toBeUndefined();
    h.s.start(0);
    const p = h.s.stop(0);
    h.advance(10_000);
    await p;
    await expect(h.s.stop(h.now)).resolves.toBeUndefined();
    h.s.start(h.now);
    expect(h.s.phase).toBe('looping');
    expect(h.s.pagesStarted).toBe(1);
  });
});
