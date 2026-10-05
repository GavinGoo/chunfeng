'use client';

// 版心内的滚动区（11 §2.3）：纸页不随内容变高；上下边缘的 16 px 渐隐遮罩只在可滚动的方向出现。
// 遮罩状态以 data-fade 写在元素上（不触发 React 重渲染）。

import { type ReactNode, useEffect, useRef } from 'react';
import styles from './AnswerPage.module.css';

export function ScrollArea({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let raf = 0;
    const update = () => {
      raf = 0;
      const top = el.scrollTop > 1;
      const bottom = el.scrollTop + el.clientHeight < el.scrollHeight - 1;
      const fade = [top ? 'top' : '', bottom ? 'bottom' : ''].filter(Boolean).join(' ');
      if (fade) el.dataset.fade = fade;
      else delete el.dataset.fade;
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    update();
    el.addEventListener('scroll', schedule, { passive: true });
    const ro = new ResizeObserver(schedule);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    // 展开说明框（grid-template-rows 过渡）期间内容高度持续变化
    el.addEventListener('transitionend', schedule);
    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener('scroll', schedule);
      el.removeEventListener('transitionend', schedule);
      ro.disconnect();
    };
  }, []);

  return (
    <div ref={ref} className={[styles.scroll, className ?? ''].join(' ')} data-scroll="">
      <div className={styles.scrollInner}>{children}</div>
    </div>
  );
}

/** 让刚展开的说明框完整进入滚动区的可视范围（只滚动版心，不牵动页面） */
export function revealInScroll(target: HTMLElement): void {
  const scroller = target.closest<HTMLElement>('[data-scroll]');
  if (!scroller) return;
  const s = scroller.getBoundingClientRect();
  const t = target.getBoundingClientRect();
  const margin = 20;
  let delta = 0;
  if (t.bottom > s.bottom - margin) delta = t.bottom - s.bottom + margin;
  // 不把选项行本身推出顶部
  const row = target.previousElementSibling?.getBoundingClientRect();
  const topLimit = (row?.top ?? t.top) - s.top - margin;
  delta = Math.min(delta, Math.max(0, topLimit));
  if (delta > 0) {
    const smooth = !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    scroller.scrollBy({ top: delta, behavior: smooth ? 'smooth' : 'auto' });
  }
}
