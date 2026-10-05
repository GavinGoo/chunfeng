import { describe, expect, it } from 'vitest';
import { easeInOut, gainAt, interpolateLevel } from '@/components/ambient/intensity';
import { createNoise3D } from '@/components/ambient/noise';
import {
  BOOK_ATTENUATION,
  bookFactor,
  ParticleSystem,
  particleCount,
  twinkle,
  WIND,
} from '@/components/ambient/particles';

describe('simplex 噪声', () => {
  it('同一种子结果确定，不同种子不同', () => {
    const a = createNoise3D(3);
    const b = createNoise3D(3);
    const c = createNoise3D(4);
    expect(a(0.3, 1.7, 2.2)).toBe(b(0.3, 1.7, 2.2));
    expect(a(0.3, 1.7, 2.2)).not.toBe(c(0.3, 1.7, 2.2));
  });

  it('输出在 [-1, 1] 内，且连续', () => {
    const n = createNoise3D(1);
    let min = 1;
    let max = -1;
    for (let i = 0; i < 5000; i++) {
      const x = i * 0.137;
      const y = i * 0.071;
      const v = n(x, y, i * 0.01);
      min = Math.min(min, v);
      max = Math.max(max, v);
      expect(Math.abs(n(x + 1e-4, y, 0) - n(x, y, 0))).toBeLessThan(0.01);
    }
    expect(min).toBeGreaterThanOrEqual(-1);
    expect(max).toBeLessThanOrEqual(1);
    expect(max - min).toBeGreaterThan(1);
  });
});

describe('背景强度（10 §2）', () => {
  it('800 ms 平滑插值，无回弹', () => {
    expect(interpolateLevel(0, 1, 0)).toBe(0);
    expect(interpolateLevel(0, 1, 400)).toBeCloseTo(0.5);
    expect(interpolateLevel(0, 1, 800)).toBe(1);
    expect(interpolateLevel(0, 1, 5000)).toBe(1);
    let prev = 0;
    for (let t = 0; t <= 1; t += 0.01) {
      const v = easeInOut(t);
      expect(v).toBeGreaterThanOrEqual(prev);
      expect(v).toBeLessThanOrEqual(1);
      prev = v;
    }
  });

  it('倍率：calm 为 1，active 为设定值', () => {
    expect(gainAt(0, 1.8)).toBe(1);
    expect(gainAt(1, 1.8)).toBe(1.8);
  });
});

describe('风中微粒（10 §3、§4）', () => {
  it('数量 40–70，核心数 ≤ 4 时减半', () => {
    expect(particleCount(390, 844)).toBe(40);
    expect(particleCount(1920, 1080)).toBe(70);
    expect(particleCount(1920, 1080, 4)).toBe(35);
    expect(particleCount(1920, 1080, 8)).toBe(70);
  });

  it('整体被风吹向右上', () => {
    const sys = new ParticleSystem(1);
    sys.resize(1000, 800, 60);
    const before = sys.particles.map((p) => ({ x: p.x, y: p.y }));
    sys.step(0.1, 0, 1);
    let dx = 0;
    let dy = 0;
    sys.particles.forEach((p, i) => {
      dx += p.x - (before[i]?.x ?? 0);
      dy += p.y - (before[i]?.y ?? 0);
    });
    expect(Math.sign(dx)).toBe(Math.sign(WIND.x));
    expect(Math.sign(dy)).toBe(Math.sign(WIND.y));
  });

  it('飘出画面后从左缘或下缘重新进入', () => {
    const sys = new ParticleSystem(2);
    sys.resize(400, 300, 40);
    for (let i = 0; i < 2000; i++) sys.step(0.05, i * 0.05, 1.8);
    for (const p of sys.particles) {
      expect(p.x).toBeGreaterThanOrEqual(-12);
      expect(p.x).toBeLessThanOrEqual(408);
      expect(p.y).toBeGreaterThanOrEqual(-8);
      expect(p.y).toBeLessThanOrEqual(312);
    }
  });

  it('闪烁在 baseAlpha 的 20%–100% 之间', () => {
    const sys = new ParticleSystem(3);
    sys.resize(400, 300, 40);
    for (const p of sys.particles) {
      expect(p.baseAlpha).toBeGreaterThanOrEqual(0.15);
      expect(p.baseAlpha).toBeLessThanOrEqual(0.45);
      for (let t = 0; t < 5; t += 0.37) {
        const a = twinkle(p, t);
        expect(a).toBeGreaterThanOrEqual(p.baseAlpha * 0.2 - 1e-9);
        expect(a).toBeLessThanOrEqual(p.baseAlpha + 1e-9);
      }
    }
  });

  it('书区域内不透明度 ×0.3，边缘羽化', () => {
    const book = { x: 100, y: 100, w: 200, h: 300 };
    expect(bookFactor(200, 200, book)).toBe(BOOK_ATTENUATION);
    expect(bookFactor(10, 10, book)).toBe(1);
    const edge = bookFactor(90, 200, book);
    expect(edge).toBeGreaterThan(BOOK_ATTENUATION);
    expect(edge).toBeLessThan(1);
    expect(bookFactor(200, 200)).toBe(1);
  });
});
