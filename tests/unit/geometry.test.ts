import { describe, expect, it } from 'vitest';
import {
  ACTION_BAR_H,
  ACTION_BAR_H_LOW,
  computeGeometry,
  LOW_VIEWPORT_H,
  PAGE_RATIO,
  REPO_LINK_SIZE,
  type Rect,
} from '@/components/book/geometry';

function intersects(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

const cases = [
  { w: 390, h: 844, mode: 'single', pageW: 358, pageH: 526, spineX: 16 },
  { w: 844, h: 390, mode: 'spread', pageW: 208, pageH: 306, spineX: 422 },
  { w: 768, h: 1024, mode: 'single', pageW: 557, pageH: 819, spineX: 106 },
  { w: 1024, h: 768, mode: 'spread', pageW: 429, pageH: 631, spineX: 512 },
  { w: 1440, h: 900, mode: 'spread', pageW: 519, pageH: 763, spineX: 720 },
  { w: 1920, h: 1080, mode: 'spread', pageW: 557, pageH: 819, spineX: 960 },
  { w: 375, h: 667, mode: 'single', pageW: 343, pageH: 504, spineX: 16 },
] as const;

describe('computeGeometry', () => {
  for (const c of cases) {
    describe(`${c.w}×${c.h}`, () => {
      const g = computeGeometry({ w: c.w, h: c.h });

      it('模式、页面尺寸与书脊位置', () => {
        expect(g.mode).toBe(c.mode);
        expect(g.page).toEqual({ w: c.pageW, h: c.pageH });
        expect(g.spineX).toBe(c.spineX);
      });

      it('页宽高比接近 0.68，页高不超过 820', () => {
        expect(Math.abs(g.page.w / g.page.h - PAGE_RATIO)).toBeLessThan(0.002);
        expect(g.page.h).toBeLessThanOrEqual(820);
      });

      const low = c.h < LOW_VIEWPORT_H;
      it('书与操作区都在视口内，操作区紧贴书的下方', () => {
        expect(g.open.x).toBeGreaterThanOrEqual(16);
        expect(g.open.x + g.open.w).toBeLessThanOrEqual(c.w - 16);
        expect(g.open.y).toBeGreaterThanOrEqual(low ? 12 : 24);
        expect(g.actionBar.y).toBe(g.open.y + g.page.h);
        expect(g.actionBar.h).toBe(low ? ACTION_BAR_H_LOW : ACTION_BAR_H);
        expect(g.actionBar.y + g.actionBar.h).toBeLessThanOrEqual(c.h - (low ? 8 : 16) + 1);
      });

      it('合上 / 打开的矩形', () => {
        if (!low) expect(g.closed.w).toBe(g.page.w);
        expect(g.closed.x).toBe(Math.round((c.w - g.closed.w) / 2));
        if (g.mode === 'single') {
          if (!low) expect(g.open).toEqual(g.closed);
          expect(g.spineX).toBe(g.open.x);
        } else {
          expect(g.open.w).toBe(2 * g.page.w);
          expect(g.open.x + g.page.w).toBe(g.spineX);
          expect(Math.abs(g.spineX - c.w / 2)).toBeLessThanOrEqual(0.5);
        }
      });

      it('页角 GitHub 链接：44 × 44，在视口内，不与书、操作区的按钮行相交（06 §7.1）', () => {
        const link = g.repoLink;
        expect(link.w).toBe(REPO_LINK_SIZE);
        expect(link.h).toBe(REPO_LINK_SIZE);
        expect(link.x).toBeGreaterThanOrEqual(0);
        expect(link.y).toBeGreaterThanOrEqual(0);
        expect(link.x + link.w).toBeLessThanOrEqual(c.w - (low ? 8 : 16));
        expect(link.y + link.h).toBeLessThanOrEqual(c.h);
        expect(intersects(link, g.open)).toBe(false);
        expect(intersects(link, g.closed)).toBe(false);
        // 按钮行：44 px 高，在操作区内垂直居中；横向按操作区全宽从严判定
        const row = {
          x: g.actionBar.x,
          y: g.actionBar.y + (g.actionBar.h - 44) / 2,
          w: g.actionBar.w,
          h: 44,
        };
        expect(intersects(link, row)).toBe(false);
      });

      it('透视距离对应 30° 视场角', () => {
        expect(g.perspective).toBeCloseTo(c.h / 2 / Math.tan((15 * Math.PI) / 180), 6);
        expect(g.perspective / c.h).toBeCloseTo(1.866, 3);
      });
    });
  }

  it('横竖判定阈值 1.05', () => {
    expect(computeGeometry({ w: 1049, h: 1000 }).mode).toBe('single');
    expect(computeGeometry({ w: 1050, h: 1000 }).mode).toBe('spread');
  });

  it('安全区：顶部让出刘海，底部让出 Home 条', () => {
    const g = computeGeometry({ w: 390, h: 844 }, { top: 47, bottom: 34, left: 0, right: 0 });
    expect(g.open.y).toBeGreaterThanOrEqual(63);
    expect(g.actionBar.y + g.actionBar.h).toBeLessThanOrEqual(844 - 34 + 1);
  });

  it('页角 GitHub 链接：宽裕时贴右下角，iPhone SE 竖屏下移到按钮行之下', () => {
    expect(computeGeometry({ w: 1440, h: 900 }).repoLink).toEqual({ x: 1380, y: 840, w: 44, h: 44 });
    expect(computeGeometry({ w: 1180, h: 820 }).repoLink).toEqual({ x: 1120, y: 760, w: 44, h: 44 });
    expect(computeGeometry({ w: 844, h: 390 }).repoLink).toEqual({ x: 792, y: 338, w: 44, h: 44 });
    // 375×667：默认 y = 607 会压到按钮行（底边 612），下移到 612 + 4
    expect(computeGeometry({ w: 375, h: 667 }).repoLink).toEqual({ x: 315, y: 616, w: 44, h: 44 });
  });

  it('页角 GitHub 链接：让出右侧与底部安全区', () => {
    const g = computeGeometry({ w: 390, h: 844 }, { top: 47, bottom: 34, left: 0, right: 0 });
    expect(g.repoLink).toEqual({ x: 330, y: 754, w: 44, h: 44 });
    const land = computeGeometry({ w: 844, h: 390 }, { top: 0, bottom: 21, left: 47, right: 47 });
    expect(land.repoLink.x + land.repoLink.w).toBeLessThanOrEqual(844 - 47);
    expect(land.repoLink.y + land.repoLink.h).toBeLessThanOrEqual(390 - 21);
  });

  it('低矮横屏：合上时封面放大（不需要操作区），比例不变，且在视口内', () => {
    const g = computeGeometry({ w: 844, h: 390 });
    expect(g.closed.w).toBeGreaterThan(g.page.w);
    expect(g.closed.w / g.page.w).toBeLessThanOrEqual(1.4 + 1e-9);
    expect(Math.abs(g.closed.w / g.closed.h - PAGE_RATIO)).toBeLessThan(0.003);
    expect(g.closed.y).toBeGreaterThanOrEqual(12);
    expect(g.closed.y + g.closed.h).toBeLessThanOrEqual(390 - 8);
    expect(g.closed).toEqual({ x: 297, y: 13, w: 251, h: 369 });
  });

  it('极小视口不产生退化尺寸', () => {
    const g = computeGeometry({ w: 200, h: 150 });
    expect(g.page.w).toBeGreaterThan(0);
    expect(g.page.h).toBeGreaterThan(0);
  });
});
