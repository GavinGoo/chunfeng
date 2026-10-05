import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// 品质档位（16 §3.12，D31）

type Mod = typeof import('@/lib/client/perfTier');

async function load(): Promise<Mod> {
  vi.resetModules();
  return import('@/lib/client/perfTier');
}

describe('detectPerfTier', () => {
  it('弱机或本次会话已降档为 lite，否则 full', async () => {
    const { detectPerfTier } = await load();
    expect(detectPerfTier({ cores: 8, memory: 8 })).toEqual({ tier: 'full', reasons: [] });
    expect(detectPerfTier({ cores: 2 }).tier).toBe('lite');
    expect(detectPerfTier({ cores: 8, memory: 2 }).reasons).toEqual(['low-end']);
    expect(detectPerfTier({ cores: 8, downgraded: true }).reasons).toEqual(['slow-flip']);
    // 核心数 4 仍属 full（微粒减半是 full 档内的处理）
    expect(detectPerfTier({ cores: 4 }).tier).toBe('full');
  });

  it('?tier= 强制档位，优先于其他判定', async () => {
    const { detectPerfTier } = await load();
    expect(detectPerfTier({ cores: 2, search: '?tier=full' })).toEqual({
      tier: 'full',
      reasons: ['override'],
    });
    expect(detectPerfTier({ cores: 8, search: '?tier=lite' }).tier).toBe('lite');
    expect(detectPerfTier({ cores: 8, search: '?tier=x' }).tier).toBe('full');
  });
});

describe('FlipFpsMonitor', () => {
  const run = async (intervalMs: number) => {
    const { FlipFpsMonitor } = await load();
    const results: number[] = [];
    const m = new FlipFpsMonitor(0, (fps) => results.push(fps));
    for (let t = 0; t <= 2600; t += intervalMs) m.frame(t);
    return { results, done: m.done };
  };

  it('起翻 300 ms 后统计 2 s，回调一次帧率', async () => {
    const fast = await run(1000 / 60);
    expect(fast.done).toBe(true);
    expect(fast.results).toHaveLength(1);
    expect(fast.results[0]).toBeCloseTo(60, 0);
    const slow = await run(25);
    expect(slow.results[0]).toBeCloseTo(40, 0);
  });

  it('作废后不回调', async () => {
    const { FlipFpsMonitor } = await load();
    const onResult = vi.fn();
    const m = new FlipFpsMonitor(0, onResult);
    for (let t = 0; t < 1000; t += 16) m.frame(t);
    m.cancel();
    for (let t = 1000; t <= 3000; t += 16) m.frame(t);
    expect(onResult).not.toHaveBeenCalled();
  });
});

describe('运行时降档', () => {
  const session = new Map<string, string>();

  beforeEach(() => {
    session.clear();
    vi.stubGlobal('window', {
      sessionStorage: {
        getItem: (k: string) => session.get(k) ?? null,
        setItem: (k: string, v: string) => session.set(k, v),
        removeItem: (k: string) => session.delete(k),
      },
    });
    vi.stubGlobal('navigator', { hardwareConcurrency: 8 });
    vi.stubGlobal('location', { search: '' });
  });

  afterEach(() => vi.unstubAllGlobals());

  it('首次翻页低于 50 fps：写入本次会话，书静止时才生效', async () => {
    const mod = await load();
    const m = mod.monitorFirstFlip(0);
    expect(m).not.toBeNull();
    for (let t = 0; t <= 2600; t += 25) m?.frame(t);
    expect(session.get('chunfeng:perf-tier')).toBe('lite');
    // 刷新后（新模块实例）按会话记录启动为 lite
    const fresh = await load();
    expect(
      fresh.detectPerfTier({ cores: 8, downgraded: session.get('chunfeng:perf-tier') === 'lite' }).tier,
    ).toBe('lite');
    // 只测首次翻页
    expect(mod.monitorFirstFlip(5000)).toBeNull();
    // 翻页途中不切换：书进入 open / closed 时才生效
    expect(mod.getPerfTier()).toBe('full');
    mod.applyPendingPerfTier();
    expect(mod.getPerfTier()).toBe('lite');
  });

  it('?tier=full 强制时不降档', async () => {
    vi.stubGlobal('location', { search: '?tier=full' });
    const mod = await load();
    mod.downgradePerfTier('slow-flip');
    mod.applyPendingPerfTier();
    expect(mod.getPerfTier()).toBe('full');
    expect(session.has('chunfeng:perf-tier')).toBe(false);
  });

  it('帧率达标时不降档', async () => {
    const mod = await load();
    const m = mod.monitorFirstFlip(0);
    for (let t = 0; t <= 2600; t += 1000 / 60) m?.frame(t);
    expect(session.has('chunfeng:perf-tier')).toBe(false);
  });
});

describe('localStorage 强制档位', () => {
  it('次于 ?tier=，优先于其他判定', async () => {
    const { detectPerfTier } = await load();
    expect(detectPerfTier({ cores: 2, stored: 'full' })).toEqual({ tier: 'full', reasons: ['override'] });
    expect(detectPerfTier({ cores: 8, stored: 'full', search: '?tier=lite' }).tier).toBe('lite');
    expect(detectPerfTier({ cores: 2, stored: 'bogus' }).tier).toBe('lite');
  });
});
