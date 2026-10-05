'use client';

// 书内透光与落页微光（09 §5.1）：翻页层之上的光幕，与翻页引擎无关（WebGL 与 CSS 引擎共用）。
//
// 接口：<Lumen lumen="off" | "flow" | "bloom" cut={…} mode={…} />
// - flow：翻页中，纸页从书脊一侧透出暖光（CSS 过渡与呼吸）；
// - bloom：落页（进入 revealing），透光淡出，同时一团暖白光在答案将要出现处晕开（WAAPI，1400 ms，不推迟显现）；
// - off：bloom 未播完时（跳过）150 ms 淡出；cut（closing、dissolving）时立即隐藏。
// 减少动态效果时由调用方不渲染。

import { useEffect, useRef } from 'react';
import type { BookMode } from './geometry';
import styles from './Lumen.module.css';

export type LumenPhase = 'off' | 'flow' | 'bloom';

export const BLOOM_MS = 1400;
const BLOOM_PEAK_MS = 500;
export const BLOOM_SKIP_FADE_MS = 150;
const EASE_SOFT = 'cubic-bezier(.2,.7,.2,1)';

export interface LumenProps {
  lumen: LumenPhase;
  /** 合书或重新生成：立即隐藏 */
  cut: boolean;
  mode: BookMode | null;
}

export function Lumen({ lumen, cut, mode }: LumenProps) {
  const bloomRef = useRef<HTMLDivElement>(null);
  const animRef = useRef<Animation | null>(null);

  useEffect(() => {
    const el = bloomRef.current;
    if (!el) return;
    if (lumen === 'bloom') {
      animRef.current?.cancel();
      animRef.current = el.animate(
        // 晕开（0–500 ms）与化开（500–1400 ms）两段各自缓出
        [
          { opacity: 0, transform: 'scale(.92)', easing: EASE_SOFT },
          { opacity: 1, transform: 'scale(1)', offset: BLOOM_PEAK_MS / BLOOM_MS, easing: EASE_SOFT },
          { opacity: 0, transform: 'scale(1.04)' },
        ],
        { duration: BLOOM_MS },
      );
      return;
    }
    const anim = animRef.current;
    animRef.current = null;
    if (anim?.playState !== 'running') return;
    if (cut) {
      anim.cancel();
      return;
    }
    // 跳过：从当前不透明度起 150 ms 淡出，结束后取消原动画
    const from = getComputedStyle(el);
    const fade = el.animate(
      [
        { opacity: from.opacity, transform: from.transform },
        { opacity: 0, transform: from.transform },
      ],
      { duration: BLOOM_SKIP_FADE_MS, easing: 'linear' },
    );
    anim.cancel();
    fade.onfinish = () => fade.cancel();
  }, [lumen, cut]);

  return (
    <div
      className={styles.lumen}
      data-lumen={lumen}
      data-mode={mode ?? 'single'}
      data-cut={cut || undefined}
      data-testid="lumen"
      aria-hidden="true"
    >
      <div className={styles.flow} />
      <div ref={bloomRef} className={styles.bloom} />
    </div>
  );
}
