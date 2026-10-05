/**
 * 翻页画布的范围（16 §3.3）：画布不再铺满视口，只覆盖纸页在整个翻动过程中可能投影到的范围与视口的交集。
 * 用卷曲模型（curl.ts，与着色器同一套公式）对整条时间线采样、按相机投影后取包围盒；
 * WebGL 引擎再用 camera.setViewOffset 只渲染全视口投影中的这一块，投影不变，与 DOM 仍逐像素对齐。
 */

import type { BookGeometry } from '@/components/book/geometry';
import { curlAt, curlPoint, easeFinal, easeInOutCubic } from './curl';

/** 视口坐标（CSS px，左上角为原点），均为整数 */
export interface CanvasRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface CurlRanges {
  theta0Range: readonly [number, number];
  /** Rmax / W */
  rMaxRange: readonly [number, number];
}

/** 包围盒外扩的余量（CSS px）：纸页的抗锯齿边缘与采样间隙 */
const MARGIN = 6;
const T_STEPS = 48;
const GRID = 8;
/** 纸页离相机过近（D − z 太小）时放弃裁剪，退回全视口 */
const MIN_DEPTH_RATIO = 0.2;

export function flipCanvasRect(
  vw: number,
  vh: number,
  g: Pick<BookGeometry, 'page' | 'open' | 'spineX' | 'perspective'>,
  ranges: CurlRanges,
): CanvasRect {
  const full: CanvasRect = { x: 0, y: 0, w: Math.ceil(vw), h: Math.ceil(vh) };
  const W = g.page.w;
  const H = g.page.h;
  const D = g.perspective;
  if (!(W > 0 && H > 0 && D > 0 && vw > 0 && vh > 0)) return full;
  const cx = vw / 2;
  const cy = vh / 2;
  // 书脊中点在屏幕上的位置（左上角原点）
  const sx = g.spineX;
  const sy = g.open.y + H / 2;

  let minX = sx - W;
  let maxX = sx + W;
  let minY = sy - H / 2;
  let maxY = sy + H / 2;
  // 纸页局部坐标（curl.ts：原点在书脊中点，x 指向外缘、翻过书脊后为负，y 向上）→ 屏幕：以视口中心为灭点按 D / (D − z) 放大
  const project = (x: number, y: number, z: number): boolean => {
    const depth = D - z;
    if (depth < D * MIN_DEPTH_RATIO) return false;
    const k = D / depth;
    const px = cx + (sx + x - cx) * k;
    const py = cy + (sy - y - cy) * k;
    if (px < minX) minX = px;
    if (px > maxX) maxX = px;
    if (py < minY) minY = py;
    if (py > maxY) maxY = py;
    return true;
  };

  for (const theta0 of ranges.theta0Range) {
    for (const ratio of ranges.rMaxRange) {
      const shape = { W, H, theta0, rMax: ratio * W };
      for (const ease of [easeInOutCubic, easeFinal]) {
        for (let i = 0; i <= T_STEPS; i++) {
          const c = curlAt(i / T_STEPS, shape, ease);
          for (let gx = 0; gx <= GRID; gx++) {
            for (let gy = 0; gy <= GRID; gy++) {
              const p = curlPoint({ x: (gx / GRID) * W, y: (gy / GRID - 0.5) * H }, c);
              if (!project(p.x, p.y, p.z)) return full;
            }
          }
        }
      }
    }
  }

  const x0 = Math.max(0, Math.floor(minX - MARGIN));
  const y0 = Math.max(0, Math.floor(minY - MARGIN));
  const x1 = Math.min(Math.ceil(vw), Math.ceil(maxX + MARGIN));
  const y1 = Math.min(Math.ceil(vh), Math.ceil(maxY + MARGIN));
  if (x1 <= x0 || y1 <= y0) return full;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
