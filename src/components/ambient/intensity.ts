// 背景强度（10 §2）：平静态 calm = 0，活跃态 active = 1，两者之间 800 ms 平滑插值。

export type AmbientIntensity = 'calm' | 'active';

export const INTENSITY_TRANSITION_MS = 800;

/** 活跃态相对平静态的倍率 */
export const ACTIVE_GAIN = {
  particleSpeed: 1.8,
  mistOpacity: 1.3,
  mistDrift: 1.5,
} as const;

export function intensityLevel(intensity: AmbientIntensity): number {
  return intensity === 'active' ? 1 : 0;
}

/** 缓入缓出（无回弹） */
export function easeInOut(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
}

/** 从 from 过渡到 to，已经过 elapsedMs 时的强度 */
export function interpolateLevel(from: number, to: number, elapsedMs: number): number {
  return from + (to - from) * easeInOut(elapsedMs / INTENSITY_TRANSITION_MS);
}

/** 按强度取倍率：level 0 → 1，level 1 → gain */
export function gainAt(level: number, gain: number): number {
  return 1 + (gain - 1) * level;
}
