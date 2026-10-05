/**
 * 圆柱卷曲模型（09 §4）的纯 TS 实现。
 *
 * - `curlPoint` 与顶点着色器（shaders.ts 中的 CURL_GLSL）使用同一套公式，修改时两处必须同步。
 * - `curlAt` 是单页翻动的时间线（09 §4.3），在 CPU 上逐帧求出 d / θ / R 后作为 uniform 传给着色器。
 *
 * 纸页局部坐标：原点在书脊中点，x ∈ [0, W] 从书脊指向外缘，y ∈ [−H/2, H/2]（向上），页面位于 z = 0。
 */

export interface Vec2 {
  x: number;
  y: number;
}

export interface CurlParams {
  /** 卷曲线到原点的距离 */
  d: number;
  /** 卷曲线倾角（θ > 0 时右下角先翻起） */
  theta: number;
  /** 卷曲半径 */
  R: number;
}

export interface CurlResult {
  x: number;
  y: number;
  z: number;
  /** 卷曲角 0..π */
  a: number;
  /** 正面法线 */
  nx: number;
  ny: number;
  nz: number;
}

/** 着色器中对 R 的下限，避免除零（与 GLSL 中的 max(uR, 0.5) 保持一致） */
export const MIN_SHADER_R = 0.25;

export function curlPoint(p: Vec2, c: CurlParams): CurlResult {
  const R = Math.max(c.R, MIN_SHADER_R);
  const nx = Math.cos(c.theta);
  const ny = -Math.sin(c.theta);
  const s = p.x * nx + p.y * ny - c.d;
  if (s <= 0) {
    return { x: p.x, y: p.y, z: 0, a: 0, nx: 0, ny: 0, nz: 1 };
  }
  const halfC = Math.PI * R;
  if (s < halfC) {
    const a = s / R;
    const k = R * Math.sin(a) - s;
    return {
      x: p.x + nx * k,
      y: p.y + ny * k,
      z: R * (1 - Math.cos(a)),
      a,
      nx: -Math.sin(a) * nx,
      ny: -Math.sin(a) * ny,
      nz: Math.cos(a),
    };
  }
  const k = -s - (s - halfC);
  return { x: p.x + nx * k, y: p.y + ny * k, z: 2 * R, a: Math.PI, nx: 0, ny: 0, nz: -1 };
}

// ---------------------------------------------------------------------------
// 缓动

export function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

export function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

export function easeInOutCubic(t: number): number {
  const x = clamp(t, 0, 1);
  return x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2;
}

/** CSS cubic-bezier 的数值实现（x1、x2 ∈ [0, 1]） */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): (t: number) => number {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const sx = (u: number) => ((ax * u + bx) * u + cx) * u;
  const sy = (u: number) => ((ay * u + by) * u + cy) * u;
  const dx = (u: number) => (3 * ax * u + 2 * bx) * u + cx;
  return (t: number) => {
    const x = clamp(t, 0, 1);
    if (x === 0 || x === 1) return x;
    let u = x;
    for (let i = 0; i < 8; i++) {
      const err = sx(u) - x;
      if (Math.abs(err) < 1e-6) return sy(u);
      const d = dx(u);
      if (Math.abs(d) < 1e-6) break;
      u -= err / d;
    }
    // 牛顿法不收敛时退回二分
    let lo = 0;
    let hi = 1;
    u = x;
    for (let i = 0; i < 30; i++) {
      const v = sx(u);
      if (Math.abs(v - x) < 1e-6) break;
      if (v < x) lo = u;
      else hi = u;
      u = (lo + hi) / 2;
    }
    return sy(u);
  };
}

/** 收尾最后一页：起势同常规页，落下的后半程更长、更柔和（09 §5） */
export const easeFinal = cubicBezier(0.55, 0, 0.35, 1);

// ---------------------------------------------------------------------------
// 时间线（09 §4.3）

export interface FlipShape {
  W: number;
  H: number;
  /** 初始卷曲线倾角（rad） */
  theta0: number;
  /** 最大卷曲半径（px） */
  rMax: number;
}

/** 起始时整页都在卷曲线内侧 */
export function startDistance(W: number, H: number, theta0: number): number {
  return W * Math.cos(theta0) + (H / 2) * Math.sin(theta0) + 2;
}

export function curlAt(
  t: number,
  shape: FlipShape,
  ease: (t: number) => number = easeInOutCubic,
): CurlParams {
  const tt = clamp(t, 0, 1);
  const e = ease(tt);
  const d0 = startDistance(shape.W, shape.H, shape.theta0);
  const d = d0 * (1 - e);
  const theta = Math.min(shape.theta0, Math.asin(clamp((2 * d) / shape.H, 0, 1)));
  const R = Math.max(
    MIN_SHADER_R,
    shape.rMax * Math.sin(Math.PI * tt) ** 0.8 * (1 - smoothstep(0.85, 1, tt)),
  );
  return { d, theta, R };
}

// ---------------------------------------------------------------------------
// 每页随机化范围（09 §4.3）

export const THETA0_RANGE: readonly [number, number] = [0.12, 0.26];
/** Rmax 相对页宽的比例 */
export const RMAX_RANGE: readonly [number, number] = [0.18, 0.28];
/** 时长相对基准的倍率 */
export const DURATION_JITTER: readonly [number, number] = [0.85, 1.15];

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
