// 封面开合的动效计算（08 §6）：纯函数，便于测试。

/** 与 --ease-page 相同的曲线 */
export const EASE_PAGE = [0.45, 0.05, 0.25, 1] as const;
export const EASE_PAGE_CSS = 'cubic-bezier(.45,.05,.25,1)';
export const COVER_DURATION_MS = 1100;
/** 减少动态效果：只做 ≤ 200 ms 的交叉淡化（06 §6） */
export const COVER_REDUCED_MS = 200;
/** 单页模式：转过 100° 开始淡出，160° 时完全透明 */
export const SINGLE_FADE_FROM_DEG = 100;
export const SINGLE_FADE_TO_DEG = 160;

/** 三次贝塞尔缓动：返回 t（时间进度）→ 数值进度 */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): (t: number) => number {
  const bx = (u: number) => 3 * x1 * u * (1 - u) ** 2 + 3 * x2 * u ** 2 * (1 - u) + u ** 3;
  const by = (u: number) => 3 * y1 * u * (1 - u) ** 2 + 3 * y2 * u ** 2 * (1 - u) + u ** 3;
  return (t: number) => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    // 二分求 u，使 bx(u) = t（x 单调，二分稳定）
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      if (bx(mid) < t) lo = mid;
      else hi = mid;
    }
    return by((lo + hi) / 2);
  };
}

/** 反解：在缓动 ease 下，数值进度首次达到 progress 时的时间进度 */
export function timeForProgress(ease: (t: number) => number, progress: number): number {
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (ease(mid) < progress) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

const easePage = cubicBezier(...EASE_PAGE);

/**
 * 单页模式下封面不透明度的关键帧（线性时间轴）。
 * 旋转用 --ease-page，所以要把 100° / 160° 换算成对应的时间偏移。
 */
export function singleModeFadeOffsets(): { start: number; end: number } {
  return {
    start: timeForProgress(easePage, SINGLE_FADE_FROM_DEG / 180),
    end: timeForProgress(easePage, SINGLE_FADE_TO_DEG / 180),
  };
}

export interface CoverKeyframes {
  rotate: Keyframe[];
  fade?: Keyframe[];
}

/** 打开（opening = true）或合上时的关键帧 */
export function coverKeyframes(mode: 'single' | 'spread', opening: boolean): CoverKeyframes {
  const closed = { transform: 'rotateY(0deg)' };
  const opened = { transform: 'rotateY(-180deg)' };
  const rotate = opening ? [closed, opened] : [opened, closed];
  if (mode === 'spread') return { rotate };
  const { start, end } = singleModeFadeOffsets();
  // 合上时时间轴反向：打开时的偏移 o 对应合上时的 1 − o（缓动曲线关于中心对称时严格成立，这里足够接近）
  const fade: Keyframe[] = opening
    ? [
        { opacity: 1, offset: 0 },
        { opacity: 1, offset: start },
        { opacity: 0, offset: end },
        { opacity: 0, offset: 1 },
      ]
    : [
        { opacity: 0, offset: 0 },
        { opacity: 0, offset: 1 - end },
        { opacity: 1, offset: 1 - start },
        { opacity: 1, offset: 1 },
      ];
  return { rotate, fade };
}
