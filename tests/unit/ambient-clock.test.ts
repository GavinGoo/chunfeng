import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// 背景时钟（16 §3.8）：约 30 Hz、共用一拍、页面隐藏时停止且不补算

type ClockModule = typeof import('@/components/ambient/clock');

let visibilityListener: (() => void) | null = null;
const doc = {
  hidden: false,
  addEventListener: vi.fn((type: string, fn: () => void) => {
    if (type === 'visibilitychange') visibilityListener = fn;
  }),
  removeEventListener: vi.fn((type: string) => {
    if (type === 'visibilitychange') visibilityListener = null;
  }),
};

async function load(): Promise<ClockModule> {
  vi.resetModules();
  return import('@/components/ambient/clock');
}

beforeEach(() => {
  // Node 没有 rAF：先放占位，假计时器才会接管它
  vi.stubGlobal('requestAnimationFrame', () => 0);
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
  vi.useFakeTimers({
    toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance'],
  });
  vi.stubGlobal('window', globalThis);
  vi.stubGlobal('document', doc);
  doc.hidden = false;
  visibilityListener = null;
  doc.addEventListener.mockClear();
  doc.removeEventListener.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('subscribeAmbientClock', () => {
  it('约 30 Hz，dt 为两拍之间的秒数', async () => {
    const { subscribeAmbientClock, MAX_DT } = await load();
    const dts: number[] = [];
    const off = subscribeAmbientClock((dt) => dts.push(dt));
    vi.advanceTimersByTime(1000);
    off();
    expect(dts.length).toBeGreaterThanOrEqual(25);
    expect(dts.length).toBeLessThanOrEqual(31);
    for (const dt of dts.slice(1)) {
      expect(dt).toBeGreaterThan(0.025);
      expect(dt).toBeLessThanOrEqual(MAX_DT);
    }
  });

  it('多个订阅者共用同一拍', async () => {
    const { subscribeAmbientClock } = await load();
    let a = 0;
    let b = 0;
    const offA = subscribeAmbientClock(() => a++);
    const offB = subscribeAmbientClock(() => b++);
    vi.advanceTimersByTime(500);
    offA();
    offB();
    expect(a).toBeGreaterThan(10);
    expect(Math.abs(a - b)).toBeLessThanOrEqual(1);
  });

  it('最后一个订阅者退订后停止，并移除可见性监听', async () => {
    const { subscribeAmbientClock } = await load();
    let n = 0;
    const off = subscribeAmbientClock(() => n++);
    vi.advanceTimersByTime(200);
    off();
    const after = n;
    vi.advanceTimersByTime(1000);
    expect(n).toBe(after);
    expect(doc.removeEventListener).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
    expect(vi.getTimerCount()).toBe(0);
  });

  it('页面隐藏时停止；回到前台从当前时刻继续，不补算', async () => {
    const { subscribeAmbientClock } = await load();
    const dts: number[] = [];
    const off = subscribeAmbientClock((dt) => dts.push(dt));
    vi.advanceTimersByTime(200);
    doc.hidden = true;
    visibilityListener?.();
    const before = dts.length;
    vi.advanceTimersByTime(5000);
    expect(dts.length).toBe(before);
    doc.hidden = false;
    visibilityListener?.();
    vi.advanceTimersByTime(100);
    off();
    expect(dts.length).toBeGreaterThan(before);
    expect(dts[before]).toBeLessThan(0.05);
  });
});
