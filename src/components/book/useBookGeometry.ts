'use client';

// 书的几何随视口变化（07 §3）：resize / orientationchange 以 rAF 节流；
// 输入框聚焦期间冻结（移动端键盘会改变视口），失焦 300 ms 后再重新计算。

import { type RefObject, useEffect, useRef, useState } from 'react';
import { type BookGeometry, computeGeometry, type SafeArea, sameGeometry } from './geometry';

export const UNFREEZE_DELAY_MS = 300;

/** 几何 + 计算时的视口尺寸 */
export interface StageGeometry extends BookGeometry {
  vw: number;
  vh: number;
}

function readSafeArea(probe: HTMLElement | null): SafeArea {
  if (!probe) return { top: 0, bottom: 0, left: 0, right: 0 };
  const cs = getComputedStyle(probe);
  const px = (v: string) => Number.parseFloat(v) || 0;
  return {
    top: px(cs.paddingTop),
    bottom: px(cs.paddingBottom),
    left: px(cs.paddingLeft),
    right: px(cs.paddingRight),
  };
}

function isTextInput(el: EventTarget | null): boolean {
  return el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement;
}

/**
 * @param probeRef 一个 padding 为 env(safe-area-inset-*) 的隐藏元素，用于读取安全区
 * @returns 客户端几何；服务端与首帧为 null（此时由 CSS 的近似布局兜底）
 */
export function useBookGeometry(probeRef: RefObject<HTMLElement | null>): StageGeometry | null {
  const [geometry, setGeometry] = useState<StageGeometry | null>(null);
  const frozen = useRef(false);
  const dirty = useRef(false);

  useEffect(() => {
    let raf = 0;
    let unfreeze: ReturnType<typeof setTimeout> | undefined;
    const measure = () => {
      raf = 0;
      if (frozen.current) {
        dirty.current = true;
        return;
      }
      dirty.current = false;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const next: StageGeometry = {
        ...computeGeometry({ w: vw, h: vh }, readSafeArea(probeRef.current)),
        vw,
        vh,
      };
      setGeometry((prev) =>
        prev && prev.vw === vw && prev.vh === vh && sameGeometry(prev, next) ? prev : next,
      );
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(measure);
    };
    const onFocusIn = (e: FocusEvent) => {
      if (!isTextInput(e.target)) return;
      clearTimeout(unfreeze);
      frozen.current = true;
    };
    const onFocusOut = (e: FocusEvent) => {
      if (!isTextInput(e.target)) return;
      clearTimeout(unfreeze);
      unfreeze = setTimeout(() => {
        frozen.current = false;
        if (dirty.current) schedule();
      }, UNFREEZE_DELAY_MS);
    };
    measure();
    window.addEventListener('resize', schedule);
    window.addEventListener('orientationchange', schedule);
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('focusout', onFocusOut);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(unfreeze);
      window.removeEventListener('resize', schedule);
      window.removeEventListener('orientationchange', schedule);
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('focusout', onFocusOut);
    };
  }, [probeRef]);

  return geometry;
}

/** 合上时书相对打开态右页（书脊处）的变换：横屏时平移到中央，低矮视口时放大 */
export function closedTransform(g: BookGeometry): string {
  const dx = g.closed.x - g.spineX;
  const dy = g.closed.y - g.open.y;
  const s = g.closed.w / g.page.w;
  if (dx === 0 && dy === 0 && Math.abs(s - 1) < 1e-4) return 'none';
  return `translate(${dx}px, ${dy}px) scale(${s.toFixed(5)})`;
}

/** 写到舞台根节点的 CSS 变量（覆盖 CSS 中的近似布局） */
export function geometryVars(g: StageGeometry): Record<string, string> {
  return {
    '--vw': `${g.vw}px`,
    '--vh': `${g.vh}px`,
    '--page-w': `${g.page.w}px`,
    '--page-h': `${g.page.h}px`,
    '--book-x': `${g.spineX}px`,
    '--book-y': `${g.open.y}px`,
    '--bar-x': `${g.actionBar.x}px`,
    '--bar-y': `${g.actionBar.y}px`,
    '--bar-w': `${g.actionBar.w}px`,
    '--bar-h': `${g.actionBar.h}px`,
    '--repo-x': `${g.repoLink.x}px`,
    '--repo-y': `${g.repoLink.y}px`,
    '--persp': `${g.perspective}px`,
    '--closed-transform': closedTransform(g),
  };
}
