/**
 * 三种引擎共用的小工具：层容器、淡入淡出、页面矩形、开发钩子。
 */

import type { BookGeometry, Rect } from '@/components/book/geometry';
import type { FlipDevHook, FlipEngineKind } from './types';

export const IS_DEV = process.env.NODE_ENV !== 'production';

/** 右页（翻动页所在的一侧）矩形：书脊在左缘 */
export function rightPageRect(g: BookGeometry): Rect {
  return { x: g.spineX, y: g.open.y, w: g.page.w, h: g.page.h };
}

/** 左页矩形（仅双页模式有意义） */
export function leftPageRect(g: BookGeometry): Rect {
  return { x: g.spineX - g.page.w, y: g.open.y, w: g.page.w, h: g.page.h };
}

export function placeRect(el: HTMLElement, r: Rect): void {
  el.style.left = `${r.x}px`;
  el.style.top = `${r.y}px`;
  el.style.width = `${r.w}px`;
  el.style.height = `${r.h}px`;
}

/**
 * 在引擎层内创建一个铺满的容器。层本身应为全视口（position: fixed; inset: 0; pointer-events: none）。
 */
export function createRoot(layer: HTMLElement, kind: FlipEngineKind): HTMLDivElement {
  const root = document.createElement('div');
  root.dataset.flipEngine = kind;
  root.setAttribute('aria-hidden', 'true');
  Object.assign(root.style, {
    position: 'absolute',
    inset: '0',
    pointerEvents: 'none',
    opacity: '0',
    overflow: 'hidden',
    contain: 'strict',
  } satisfies Partial<CSSStyleDeclaration>);
  layer.appendChild(root);
  return root;
}

/** 以 WAAPI 做透明度过渡，结束时把最终值写回 style，返回 Promise */
export function fadeTo(el: HTMLElement, to: number, ms: number): Promise<void> {
  const from = Number.parseFloat(getComputedStyle(el).opacity || '0');
  for (const a of el.getAnimations()) {
    if ((a as Animation & { id?: string }).id === 'flip-fade') a.cancel();
  }
  if (ms <= 0 || Math.abs(from - to) < 0.001) {
    el.style.opacity = String(to);
    return Promise.resolve();
  }
  const anim = el.animate([{ opacity: from }, { opacity: to }], {
    duration: ms,
    easing: 'cubic-bezier(.2,.7,.2,1)',
    fill: 'forwards',
    id: 'flip-fade',
  });
  el.style.opacity = String(to);
  return anim.finished.then(
    () => {
      anim.cancel();
    },
    () => undefined,
  );
}

export function waitFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

export function registerDevHook(hook: FlipDevHook): void {
  if (!IS_DEV || typeof window === 'undefined') return;
  window.__flip = hook;
}

export function unregisterDevHook(kind: FlipEngineKind, hook: FlipDevHook): void {
  if (!IS_DEV || typeof window === 'undefined') return;
  if (window.__flip === hook || window.__flip?.kind === kind) window.__flip = undefined;
}

export function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}
