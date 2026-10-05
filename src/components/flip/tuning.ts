/**
 * 可调参数（09 §9 调试面板直接修改此对象）。默认值即 09 §4.3 / §5 定稿的参数。
 */

import { DEFAULT_RHYTHM, type Rhythm } from './scheduler';

export interface FlipTuning {
  theta0Min: number;
  theta0Max: number;
  /** Rmax / W */
  rMaxMin: number;
  rMaxMax: number;
  /** 稳定节奏：单页时长（ms） */
  duration: number;
  /** 稳定节奏：起页间隔（ms） */
  interval: number;
  /** 月光方向（指向光源），会被归一化 */
  lightX: number;
  lightY: number;
  lightZ: number;
  /** 卷起处投在下一页上的影子强度（× sin πt） */
  curlShadow: number;
  /** 翻起部分（折返平铺段）边缘投在其下纸面上的影子强度 */
  foldShadow: number;
}

export const tuning: FlipTuning = {
  theta0Min: DEFAULT_RHYTHM.theta0Range[0],
  theta0Max: DEFAULT_RHYTHM.theta0Range[1],
  rMaxMin: DEFAULT_RHYTHM.rMaxRange[0],
  rMaxMax: DEFAULT_RHYTHM.rMaxRange[1],
  duration: DEFAULT_RHYTHM.duration,
  interval: DEFAULT_RHYTHM.interval,
  lightX: -0.35,
  lightY: 0.45,
  lightZ: 0.82,
  curlShadow: 0.22,
  foldShadow: 0.2,
};

type Listener = () => void;
const listeners = new Set<Listener>();

export function onTuningChange(cb: Listener): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function setTuning(patch: Partial<FlipTuning>): void {
  Object.assign(tuning, patch);
  for (const cb of listeners) cb();
}

export function rhythmFromTuning(base: Rhythm = DEFAULT_RHYTHM): Rhythm {
  return {
    ...base,
    duration: tuning.duration,
    interval: tuning.interval,
    theta0Range: [tuning.theta0Min, tuning.theta0Max],
    rMaxRange: [tuning.rMaxMin, tuning.rMaxMax],
  };
}

export function lightDir(): [number, number, number] {
  const { lightX: x, lightY: y, lightZ: z } = tuning;
  const len = Math.hypot(x, y, z) || 1;
  return [x / len, y / len, z / len];
}

/** 实时帧率统计（调试面板读取） */
export const fpsMeter = {
  enabled: false,
  frames: [] as number[],
  mark(now: number): void {
    if (!this.enabled) return;
    this.frames.push(now);
    while (this.frames.length > 0 && now - (this.frames[0] ?? now) > 1000) this.frames.shift();
  },
  fps(): number {
    return this.frames.length;
  },
};
