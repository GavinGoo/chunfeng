// 风中微粒的纯逻辑（10 §3）：生成、积分、重生、闪烁与书区域衰减。与画布无关，便于测试。

import { createNoise3D, type Noise3D, seededRandom } from './noise';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Particle {
  x: number;
  y: number;
  /** 半径（px），对应 1–2.5 px 的光点直径 */
  size: number;
  /** 0 = 金色，1 = 春绿 */
  tint: 0 | 1;
  baseAlpha: number;
  /** 闪烁频率（Hz） */
  freq: number;
  phase: number;
}

/** 恒定风向：向右上（屏幕坐标） */
export const WIND = { x: 0.6, y: -0.35 } as const;
/** 平静态下的基础速度（px/s） */
export const BASE_SPEED = 22;
const NOISE_SCALE = 0.002;
const NOISE_TIME = 0.05;
const NOISE_GAIN = 0.4;
/** 书区域内的不透明度倍率 */
export const BOOK_ATTENUATION = 0.3;
const BOOK_FEATHER = 24;

/** 按视口面积决定微粒数量：40–70；核心数 ≤ 4 时减半 */
/** 核心数 ≤ 4 视为性能有限：微粒减半，星点闪烁 B 层不动画（10 §2.1、§4） */
export function isFewCores(cores?: number): boolean {
  return cores !== undefined && cores <= 4;
}

export function particleCount(width: number, height: number, cores?: number): number {
  const byArea = Math.round((width * height) / 22000);
  const n = Math.min(70, Math.max(40, byArea));
  return isFewCores(cores) ? Math.round(n / 2) : n;
}

export class ParticleSystem {
  readonly particles: Particle[] = [];
  private readonly noise: Noise3D;
  private readonly random: () => number;
  private width = 0;
  private height = 0;

  constructor(seed = 7) {
    this.noise = createNoise3D(seed);
    this.random = seededRandom(seed * 31 + 1);
  }

  resize(width: number, height: number, count: number): void {
    this.width = width;
    this.height = height;
    while (this.particles.length > count) this.particles.pop();
    for (const p of this.particles) {
      if (p.x > width + 8 || p.y > height + 8) this.place(p, true);
    }
    while (this.particles.length < count) {
      const p = this.create();
      this.place(p, true);
      this.particles.push(p);
    }
  }

  private create(): Particle {
    const r = this.random;
    return {
      x: 0,
      y: 0,
      size: 0.5 + r() * 0.75,
      tint: r() < 0.62 ? 0 : 1,
      baseAlpha: 0.15 + r() * 0.3,
      freq: 0.3 + r() * 0.5,
      phase: r() * Math.PI * 2,
    };
  }

  /** anywhere：散布在整个画面（初始化）；否则从左缘或下缘重新进入 */
  private place(p: Particle, anywhere: boolean): void {
    const r = this.random;
    if (anywhere) {
      p.x = r() * this.width;
      p.y = r() * this.height;
      return;
    }
    // 按两条边的长度加权，风从左下吹来
    const fromLeft = r() < this.height / (this.width + this.height);
    if (fromLeft) {
      p.x = -4;
      p.y = r() * this.height;
    } else {
      p.x = r() * this.width;
      p.y = this.height + 4;
    }
  }

  /** 积分一步：dt 秒，time 秒，speedGain 为活跃态倍率 */
  step(dt: number, time: number, speedGain: number): void {
    const speed = BASE_SPEED * speedGain;
    const nt = time * NOISE_TIME;
    for (const p of this.particles) {
      const nx = this.noise(p.x * NOISE_SCALE, p.y * NOISE_SCALE, nt);
      const ny = this.noise(p.x * NOISE_SCALE + 31.7, p.y * NOISE_SCALE - 17.3, nt);
      p.x += (WIND.x + nx * NOISE_GAIN) * speed * dt;
      p.y += (WIND.y + ny * NOISE_GAIN) * speed * dt;
      if (p.x > this.width + 8 || p.y < -8 || p.x < -12 || p.y > this.height + 12) this.place(p, false);
    }
  }
}

/** 闪烁：alpha = baseAlpha · (0.6 + 0.4 · sin(2π · f · t + phase)) */
export function twinkle(p: Particle, time: number): number {
  return p.baseAlpha * (0.6 + 0.4 * Math.sin(2 * Math.PI * p.freq * time + p.phase));
}

/** 书区域衰减：书内 ×0.3，边缘 24 px 羽化 */
export function bookFactor(x: number, y: number, book?: Rect): number {
  if (!book) return 1;
  const dx = Math.max(book.x - x, 0, x - (book.x + book.w));
  const dy = Math.max(book.y - y, 0, y - (book.y + book.h));
  const d = Math.hypot(dx, dy);
  if (d >= BOOK_FEATHER) return 1;
  const t = d / BOOK_FEATHER;
  return BOOK_ATTENUATION + (1 - BOOK_ATTENUATION) * t;
}
