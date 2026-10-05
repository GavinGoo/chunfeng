/**
 * 减少动态效果引擎（09 §8）：不翻页。等待期间纸页中央一枚淡金色风纹徽记做透明度呼吸
 * （0.4 ↔ 0.8，2 s）；结果就绪后徽记淡出，内容直接淡入（由答案页负责）。
 * 只动画 opacity，不产生任何位移。
 */

import type { BookGeometry } from '@/components/book/geometry';
import { createRoot, fadeTo, placeRect, registerDevHook, rightPageRect, unregisterDevHook } from './common';
import type { FlipDevHook, FlipEngine } from './types';

const SVG_NS = 'http://www.w3.org/2000/svg';

function windEmblem(): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 64 64');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', '#e3c88a');
  svg.setAttribute('stroke-width', '1.25');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('vector-effect', 'non-scaling-stroke');
  const paths = ['M10 25 H37 a7 7 0 1 0 -7 -7', 'M6 33 H47 a8 8 0 1 1 -8 8', 'M14 41 H27', 'M20 17 H24'];
  for (const d of paths) {
    const p = document.createElementNS(SVG_NS, 'path');
    p.setAttribute('d', d);
    svg.appendChild(p);
  }
  const ring = document.createElementNS(SVG_NS, 'circle');
  ring.setAttribute('cx', '32');
  ring.setAttribute('cy', '32');
  ring.setAttribute('r', '29');
  ring.setAttribute('stroke-opacity', '0.45');
  svg.appendChild(ring);
  return svg;
}

export class ReducedMotionEngine implements FlipEngine {
  readonly kind = 'reduced' as const;
  onFallback?: (reason: string) => void;

  private root: HTMLDivElement | null = null;
  private emblem: HTMLDivElement | null = null;
  private breathing: Animation | null = null;
  private geometry: BookGeometry | null = null;
  private stopping: Promise<void> | null = null;
  private readonly hook: FlipDevHook = {
    kind: 'reduced',
    seek: (t) => {
      if (!this.root || !this.emblem) return;
      this.breathing?.pause();
      if (t === null) {
        this.breathing?.play();
        return;
      }
      this.root.style.opacity = '1';
      // 呼吸曲线上的对应位置（t ∈ [0, 1] 对应一个完整周期）
      this.emblem.style.opacity = String(0.6 - 0.2 * Math.cos(2 * Math.PI * t));
    },
  };

  async mount(layer: HTMLElement, geometry: BookGeometry): Promise<void> {
    this.root = createRoot(layer, this.kind);
    const emblem = document.createElement('div');
    Object.assign(emblem.style, {
      position: 'absolute',
      opacity: '0.4',
    } satisfies Partial<CSSStyleDeclaration>);
    const svg = windEmblem();
    svg.style.width = '100%';
    svg.style.height = '100%';
    svg.style.display = 'block';
    emblem.appendChild(svg);
    this.root.appendChild(emblem);
    this.emblem = emblem;
    this.resize(geometry);
    registerDevHook(this.hook);
  }

  startLoop(): void {
    if (!this.root || !this.emblem) return;
    this.stopping = null;
    this.breathing?.cancel();
    this.emblem.style.opacity = '0.4';
    this.breathing = this.emblem.animate([{ opacity: 0.4 }, { opacity: 0.8 }], {
      duration: 1000,
      direction: 'alternate',
      iterations: Number.POSITIVE_INFINITY,
      easing: 'ease-in-out',
    });
    void fadeTo(this.root, 1, 300);
  }

  /** 结果就绪后徽记淡出（≤ 200 ms）即 resolve，不要求最短时长 */
  stop(): Promise<void> {
    if (!this.root) return Promise.resolve();
    if (!this.stopping) {
      const root = this.root;
      this.stopping = fadeTo(root, 0, 200).then(() => {
        this.breathing?.cancel();
        this.breathing = null;
      });
    }
    return this.stopping;
  }

  flipOnce(): Promise<void> {
    return Promise.resolve();
  }

  resize(geometry: BookGeometry): void {
    this.geometry = geometry;
    if (!this.emblem) return;
    const r = rightPageRect(geometry);
    const size = Math.round(Math.min(72, Math.max(40, r.w * 0.16)));
    placeRect(this.emblem, {
      x: r.x + (r.w - size) / 2,
      y: r.y + (r.h - size) / 2,
      w: size,
      h: size,
    });
  }

  fadeOut(ms = 150): Promise<void> {
    if (!this.root) return Promise.resolve();
    return fadeTo(this.root, 0, ms).then(() => {
      this.breathing?.cancel();
      this.breathing = null;
    });
  }

  destroy(): void {
    this.breathing?.cancel();
    this.root?.remove();
    this.root = null;
    this.emblem = null;
    this.geometry = null;
    unregisterDevHook(this.kind, this.hook);
  }

  get currentGeometry(): BookGeometry | null {
    return this.geometry;
  }
}
