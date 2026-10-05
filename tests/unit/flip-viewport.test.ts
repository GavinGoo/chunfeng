import { describe, expect, it } from 'vitest';
import { computeGeometry } from '@/components/book/geometry';
import { RMAX_RANGE, THETA0_RANGE } from '@/components/flip/curl';
import { flipCanvasRect } from '@/components/flip/viewport';

// 翻页画布的范围（16 §3.3）

const RANGES = { theta0Range: THETA0_RANGE, rMaxRange: RMAX_RANGE };

describe('flipCanvasRect', () => {
  it('桌面双页：盖住两页，且比视口小', () => {
    const vw = 1440;
    const vh = 900;
    const g = computeGeometry({ w: vw, h: vh });
    expect(g.mode).toBe('spread');
    const r = flipCanvasRect(vw, vh, g, RANGES);
    expect(r.x).toBeGreaterThanOrEqual(0);
    expect(r.y).toBeGreaterThanOrEqual(0);
    expect(r.x + r.w).toBeLessThanOrEqual(vw);
    expect(r.y + r.h).toBeLessThanOrEqual(vh);
    // 平放的两页在范围内
    expect(r.x).toBeLessThanOrEqual(g.spineX - g.page.w);
    expect(r.x + r.w).toBeGreaterThanOrEqual(g.spineX + g.page.w);
    expect(r.y).toBeLessThanOrEqual(g.open.y);
    expect(r.y + r.h).toBeGreaterThanOrEqual(g.open.y + g.page.h);
    expect(r.w * r.h).toBeLessThan(vw * vh * 0.8);
  });

  it('竖屏单页：纸页翻过书脊会伸出屏幕左侧，左缘取到 0', () => {
    const vw = 390;
    const vh = 844;
    const g = computeGeometry({ w: vw, h: vh });
    expect(g.mode).toBe('single');
    const r = flipCanvasRect(vw, vh, g, RANGES);
    expect(r.x).toBe(0);
    expect(r.x + r.w).toBeGreaterThanOrEqual(g.spineX + g.page.w);
    expect(r.x + r.w).toBeLessThanOrEqual(vw);
    expect(r.y + r.h).toBeLessThanOrEqual(vh);
  });

  it('倾角越大，范围不会变小', () => {
    const g = computeGeometry({ w: 1440, h: 900 });
    const a = flipCanvasRect(1440, 900, g, RANGES);
    const b = flipCanvasRect(1440, 900, g, { ...RANGES, theta0Range: [0.12, 0.5] });
    expect(b.w * b.h).toBeGreaterThanOrEqual(a.w * a.h);
  });

  it('几何无效时退回全视口', () => {
    const g = computeGeometry({ w: 1440, h: 900 });
    expect(flipCanvasRect(1440, 900, { ...g, perspective: 0 }, RANGES)).toEqual({
      x: 0,
      y: 0,
      w: 1440,
      h: 900,
    });
  });
});
