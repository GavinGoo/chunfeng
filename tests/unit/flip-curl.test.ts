import { describe, expect, it } from 'vitest';
import {
  curlAt,
  curlPoint,
  easeFinal,
  easeInOutCubic,
  type FlipShape,
  startDistance,
} from '@/components/flip/curl';

const W = 400;
const H = 600;
const shapes: FlipShape[] = [
  { W, H, theta0: 0.12, rMax: 0.18 * W },
  { W, H, theta0: 0.19, rMax: 0.23 * W },
  { W, H, theta0: 0.26, rMax: 0.28 * W },
];
const eases = [easeInOutCubic, easeFinal];

function grid(nx = 40, ny = 60): Array<{ x: number; y: number }> {
  const pts = [];
  for (let i = 0; i <= nx; i++) {
    for (let j = 0; j <= ny; j++) pts.push({ x: (i / nx) * W, y: -H / 2 + (j / ny) * H });
  }
  return pts;
}

describe('curlPoint', () => {
  it('s ≤ 0 时平贴不动', () => {
    const r = curlPoint({ x: 50, y: 10 }, { d: 200, theta: 0.2, R: 40 });
    expect(r).toMatchObject({ x: 50, y: 10, z: 0, a: 0, nz: 1 });
  });

  it('在 s = πR 两侧连续', () => {
    const c = { d: 150, theta: 0.2, R: 40 };
    const n = { x: Math.cos(c.theta), y: -Math.sin(c.theta) };
    const halfC = Math.PI * c.R;
    const base = { x: 0, y: 30 };
    const at = (s: number) => {
      const k = c.d + s - (base.x * n.x + base.y * n.y);
      return curlPoint({ x: base.x + n.x * k, y: base.y + n.y * k }, c);
    };
    const a = at(halfC - 1e-6);
    const b = at(halfC + 1e-6);
    expect(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)).toBeLessThan(1e-3);
    expect(a.z).toBeCloseTo(2 * c.R, 4);
    const c0 = at(-1e-6);
    const c1 = at(1e-6);
    expect(Math.hypot(c0.x - c1.x, c0.y - c1.y, c0.z - c1.z)).toBeLessThan(1e-3);
  });

  it('卷曲是等距映射：相邻顶点间距保持不变（纸不被拉伸）', () => {
    const c = { d: 180, theta: 0.18, R: 60 };
    for (let x = 0; x < W; x += 5) {
      const p = curlPoint({ x, y: -120 }, c);
      const q = curlPoint({ x: x + 0.5, y: -120 }, c);
      expect(Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z)).toBeCloseTo(0.5, 2);
    }
  });
});

describe('翻页时间线', () => {
  it('t = 0 时整页平贴在原位', () => {
    for (const s of shapes) {
      const c = curlAt(0, s);
      expect(c.d).toBeCloseTo(startDistance(W, H, s.theta0), 6);
      for (const p of grid(10, 10)) {
        const r = curlPoint(p, c);
        expect(r.z).toBe(0);
      }
    }
  });

  it('书脊（x = 0）全程不动，θ 约束保证不被掀起', () => {
    for (const s of shapes) {
      for (const ease of eases) {
        for (let i = 0; i <= 200; i++) {
          const c = curlAt(i / 200, s, ease);
          for (let j = 0; j <= 60; j++) {
            const y = -H / 2 + (j / 60) * H;
            const r = curlPoint({ x: 0, y }, c);
            expect(Math.hypot(r.x, r.y - y, r.z)).toBeLessThan(1e-9);
          }
        }
      }
    }
  });

  it('若去掉 θ 约束，书脊会被掀起（反证约束的必要性）', () => {
    const s = shapes[2]!;
    const c = curlAt(0.9, s);
    const unconstrained = { ...c, theta: s.theta0 };
    const r = curlPoint({ x: 0, y: -H / 2 }, unconstrained);
    expect(r.z).toBeGreaterThan(0);
  });

  it('t = 1 时与完美镜像的偏差 < 1 px', () => {
    for (const s of shapes) {
      for (const ease of eases) {
        const c = curlAt(1, s, ease);
        let maxErr = 0;
        for (const p of grid()) {
          const r = curlPoint(p, c);
          maxErr = Math.max(maxErr, Math.hypot(r.x + p.x, r.y - p.y, r.z));
        }
        expect(maxErr).toBeLessThan(1);
      }
    }
  });

  it('中途弧度最大、最后 15% 迅速压平', () => {
    const s = shapes[1]!;
    const mid = curlAt(0.5, s).R;
    expect(mid).toBeCloseTo(s.rMax, 6);
    expect(curlAt(0.85, s).R).toBeGreaterThan(curlAt(0.95, s).R);
    expect(curlAt(1, s).R).toBe(0.25);
  });

  it('卷曲线单调扫向书脊，θ 不超过 θ0', () => {
    for (const s of shapes) {
      let prev = Number.POSITIVE_INFINITY;
      for (let i = 0; i <= 100; i++) {
        const c = curlAt(i / 100, s);
        expect(c.d).toBeLessThanOrEqual(prev + 1e-9);
        expect(c.theta).toBeLessThanOrEqual(s.theta0 + 1e-12);
        prev = c.d;
      }
    }
  });

  it('逐帧采样：相邻帧顶点位移有界（没有跳变）', () => {
    const s = shapes[1]!;
    const pts = grid(20, 20);
    let prev = pts.map((p) => curlPoint(p, curlAt(0, s)));
    for (let i = 1; i <= 120; i++) {
      const cur = pts.map((p) => curlPoint(p, curlAt(i / 120, s)));
      for (let k = 0; k < pts.length; k++) {
        const a = prev[k]!;
        const b = cur[k]!;
        expect(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)).toBeLessThan(60);
      }
      prev = cur;
    }
  });

  it('收尾缓动：两端固定，后半程更柔和', () => {
    expect(easeFinal(0)).toBe(0);
    expect(easeFinal(1)).toBe(1);
    // 落下的后半程峰值速度更低，减速拖得更长
    const peak = (f: (t: number) => number) => {
      let m = 0;
      for (let t = 0.55; t < 1; t += 0.01) m = Math.max(m, (f(t + 0.01) - f(t)) / 0.01);
      return m;
    };
    expect(peak(easeFinal)).toBeLessThan(peak(easeInOutCubic));
    expect(1 - easeFinal(0.8)).toBeGreaterThan(1 - easeInOutCubic(0.8));
  });
});
