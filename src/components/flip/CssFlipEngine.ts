/**
 * CSS 翻页引擎（09 §8）：DOM 纸页以书脊为轴 rotateY(0 → −180°) 刚性翻转；
 * 随角度变化的明暗（|sin|）；前 30% 进度加轻微 skewY 模拟纸张弯曲。
 * 明暗由每个面上三张固定的覆盖层叠出，每帧只改它们的不透明度，不重绘（16 §3.9）。
 * 与 WebGL 引擎共用循环调度器（scheduler.ts），遵循同一套循环与收尾协议。
 */

import type { BookGeometry } from '@/components/book/geometry';
import {
  createRoot,
  fadeTo,
  leftPageRect,
  placeRect,
  registerDevHook,
  rightPageRect,
  unregisterDevHook,
  waitFrame,
} from './common';
import { clamp, easeFinal, easeInOutCubic, smoothstep } from './curl';
import { browserClock, type Flight, FlipScheduler, FrameDriver } from './scheduler';
import { canvasUrl, getPageTextures, PAPER_COLOR } from './textures';
import { fpsMeter, lightDir, onTuningChange, rhythmFromTuning } from './tuning';
import type { FlipDevHook, FlipEngine } from './types';

interface PageEl {
  el: HTMLDivElement;
  front: HTMLDivElement;
  back: HTMLDivElement;
  frontShade: Shade;
  backShade: Shade;
  /** 上一帧写入的层叠顺序与不透明度：只在变化时写 */
  zIndex: string;
  opacity: string;
  flight: Flight | null;
}

type Tex = 'blank' | 0 | 1 | 2;

const INK = '20,14,8';
const WARM = '255,250,236';

/**
 * 一个面的明暗覆盖层（16 §3.9）：均匀墨色 + 向外缘加深的墨色渐变 + 受光时的暖白渐变，每帧只改三者的不透明度。
 * 同色两层叠加的透明度为 1 − (1 − a)(1 − b)，所以墨色两层能精确叠出原先「base → base + 0.14·s」的渐变。
 */
interface Shade {
  ink: HTMLDivElement;
  ramp: HTMLDivElement;
  lift: HTMLDivElement;
}

function shadeLayers(parent: HTMLElement, dir: 'left' | 'right'): Shade {
  const layer = (background: string) => {
    const d = document.createElement('div');
    Object.assign(d.style, {
      position: 'absolute',
      inset: '0',
      background,
      opacity: '0',
    } satisfies Partial<CSSStyleDeclaration>);
    parent.appendChild(d);
    return d;
  };
  return {
    ink: layer(`rgb(${INK})`),
    ramp: layer(`linear-gradient(to ${dir}, rgba(${INK},0), rgb(${INK}))`),
    lift: layer(`linear-gradient(to ${dir}, rgb(${WARM}), rgba(${WARM},0))`),
  };
}

function setOpacity(el: HTMLElement, v: number): void {
  const s = v.toFixed(3);
  if (el.style.opacity !== s) el.style.opacity = s;
}

function face(dir: 'left' | 'right'): { face: HTMLDivElement; shade: Shade } {
  const f = document.createElement('div');
  Object.assign(f.style, {
    position: 'absolute',
    inset: '0',
    backfaceVisibility: 'hidden',
    backgroundColor: PAPER_COLOR,
    backgroundSize: '100% 100%',
    overflow: 'hidden',
  } satisfies Partial<CSSStyleDeclaration>);
  f.style.setProperty('-webkit-backface-visibility', 'hidden');
  return { face: f, shade: shadeLayers(f, dir) };
}

/** 刚性纸页在旋转角 φ（0..π）下的明暗：与 WebGL 相同的光照，平放时为 1 */
function brightness(nx: number, nz: number): number {
  const [lx, , lz] = lightDir();
  const diff = Math.max(0, nx * lx + nz * lz);
  return (0.74 + 0.26 * diff) / (0.74 + 0.26 * lz);
}

/**
 * 明暗：整体亮度 + 向外缘加深的 |sin| 渐变（书脊处 base，外缘 base + 0.14·s）；受光面（b > 1）书脊处泛暖白、外缘 0.1·s 的墨色。
 * 受光时暖白与墨色是两层叠加而不是一条渐变插值，偏差不超过墨色的不透明度（≤ 0.1）乘以暖白的不透明度。
 */
function applyShade(sh: Shade, b: number, s: number): void {
  const base = b < 1 ? (1 - b) * 1.6 : 0;
  const lift = b > 1 ? (b - 1) * 1.2 : 0;
  if (lift > 0.002 && base === 0) {
    setOpacity(sh.ink, 0);
    setOpacity(sh.ramp, 0.1 * s);
    setOpacity(sh.lift, lift);
    return;
  }
  setOpacity(sh.ink, base);
  setOpacity(sh.ramp, base < 1 ? (0.14 * s) / (1 - base) : 0);
  setOpacity(sh.lift, 0);
}

export class CssFlipEngine implements FlipEngine {
  readonly kind = 'css' as const;
  onFallback?: (reason: string) => void;

  private root: HTMLDivElement | null = null;
  private leftUnder: HTMLDivElement | null = null;
  private rightUnder: HTMLDivElement | null = null;
  private rightShadow: HTMLDivElement | null = null;
  private pages: PageEl[] = [];
  private geometry: BookGeometry | null = null;
  private urls: Record<string, string> = {};
  private driver: FrameDriver | null = null;
  private scheduler: FlipScheduler;
  private texCursor = 0;
  private rightTex: Tex = 0;
  private leftTex: Tex | null = null;
  private seekT: number | null = null;
  private visible = false;
  private offTuning: (() => void) | null = null;
  private readonly hook: FlipDevHook = { kind: 'css', seek: (t) => this.seek(t) };

  constructor() {
    this.scheduler = new FlipScheduler(
      {
        onStart: (f) => this.onStart(f),
        onLand: (f) => this.onLand(f),
      },
      { rhythm: rhythmFromTuning() },
    );
  }

  async mount(layer: HTMLElement, geometry: BookGeometry): Promise<void> {
    const root = createRoot(layer, this.kind);
    this.root = root;
    const mk = () => {
      const d = document.createElement('div');
      Object.assign(d.style, {
        position: 'absolute',
        backgroundColor: PAPER_COLOR,
        backgroundSize: '100% 100%',
      } satisfies Partial<CSSStyleDeclaration>);
      root.appendChild(d);
      return d;
    };
    this.leftUnder = mk();
    this.rightUnder = mk();
    this.rightShadow = document.createElement('div');
    Object.assign(this.rightShadow.style, {
      position: 'absolute',
      inset: '0',
      opacity: '0',
      background: `linear-gradient(to right, rgba(${INK},0.32), rgba(${INK},0.12) 30%, rgba(${INK},0) 70%)`,
    } satisfies Partial<CSSStyleDeclaration>);
    this.rightUnder.appendChild(this.rightShadow);

    for (let i = 0; i < 4; i++) {
      const el = document.createElement('div');
      Object.assign(el.style, {
        position: 'absolute',
        transformOrigin: '0 50%',
        transformStyle: 'preserve-3d',
        willChange: 'transform',
        display: 'none',
      } satisfies Partial<CSSStyleDeclaration>);
      const f = face('right');
      const b = face('left');
      b.face.style.transform = 'rotateY(180deg)';
      el.append(f.face, b.face);
      root.appendChild(el);
      this.pages.push({
        el,
        front: f.face,
        back: b.face,
        frontShade: f.shade,
        backShade: b.shade,
        zIndex: '',
        opacity: '',
        flight: null,
      });
    }

    this.driver = new FrameDriver(browserClock, (now) => this.frame(now), this.scheduler);
    this.offTuning = onTuningChange(() => {
      this.scheduler.rhythm = rhythmFromTuning(this.scheduler.rhythm);
    });
    this.resize(geometry);
    await this.loadTextures(geometry);
    registerDevHook(this.hook);
  }

  startLoop(): void {
    if (!this.root || !this.driver) return;
    this.resetBook();
    this.scheduler.start(browserClock.now());
    this.show();
    this.driver.start();
  }

  async stop(opts?: { minLoopMs?: number; minPages?: number }): Promise<void> {
    await this.scheduler.stop(browserClock.now(), opts);
    this.render();
    await waitFrame();
  }

  async flipOnce(): Promise<void> {
    if (!this.root || !this.driver) return;
    this.resetBook();
    const p = this.scheduler.flipOnce(browserClock.now());
    this.show();
    this.driver.start();
    await p;
    this.render();
    await waitFrame();
  }

  resize(geometry: BookGeometry): void {
    const prev = this.geometry;
    this.geometry = geometry;
    if (!this.root) return;
    this.root.style.perspective = `${geometry.perspective}px`;
    this.root.style.perspectiveOrigin = '50% 50%';
    if (this.leftUnder) placeRect(this.leftUnder, leftPageRect(geometry));
    if (this.rightUnder) placeRect(this.rightUnder, rightPageRect(geometry));
    for (const p of this.pages) placeRect(p.el, rightPageRect(geometry));
    if (prev && (prev.page.w !== geometry.page.w || prev.page.h !== geometry.page.h)) {
      void this.loadTextures(geometry);
    }
    this.render();
  }

  async fadeOut(ms = 150): Promise<void> {
    if (!this.root) return;
    this.visible = false;
    await fadeTo(this.root, 0, ms);
    if (!this.visible) this.driver?.stop();
  }

  destroy(): void {
    this.driver?.destroy();
    this.driver = null;
    this.offTuning?.();
    this.root?.remove();
    this.root = null;
    this.pages = [];
    for (const u of Object.values(this.urls)) if (u.startsWith('blob:')) URL.revokeObjectURL(u);
    this.urls = {};
    unregisterDevHook(this.kind, this.hook);
  }

  // -------------------------------------------------------------------------

  private async loadTextures(g: BookGeometry): Promise<void> {
    try {
      const set = await getPageTextures(g.page.w, g.page.h);
      const [blank, w0, w1, w2] = await Promise.all([
        canvasUrl(set.blank),
        canvasUrl(set.written[0]),
        canvasUrl(set.written[1]),
        canvasUrl(set.written[2]),
      ]);
      this.urls = { blank, 0: w0, 1: w1, 2: w2 };
    } catch {
      // 纹理生成失败时退回纯纸色，流程不受影响
      this.urls = {};
    }
    this.applyUnderTextures();
    for (const p of this.pages) if (p.flight) this.assignPageTextures(p, p.flight);
  }

  /** 纸页纹理 + 书脊阴影（与 DOM 纸页 06 §4 相同的渐变；spine 为书脊所在的一侧） */
  private bg(tex: Tex, spine: 'left' | 'right'): string {
    const u = this.urls[String(tex)];
    const gutter = `linear-gradient(to ${spine === 'left' ? 'right' : 'left'}, rgba(0,0,0,0.22), transparent 10%)`;
    return u ? `${gutter}, url("${u}")` : gutter;
  }

  private show(): void {
    if (!this.root) return;
    this.visible = true;
    void fadeTo(this.root, 1, 200);
  }

  private resetBook(): void {
    this.seekT = null;
    this.texCursor = 0;
    this.rightTex = 0;
    this.leftTex = null;
    for (const p of this.pages) {
      p.flight = null;
      p.el.style.display = 'none';
    }
    this.applyUnderTextures();
  }

  private applyUnderTextures(): void {
    if (!this.rightUnder || !this.leftUnder || !this.geometry) return;
    this.rightUnder.style.backgroundImage = this.bg(this.rightTex, 'left');
    const showLeft = this.geometry.mode === 'spread' && this.leftTex !== null;
    this.leftUnder.style.display = showLeft ? 'block' : 'none';
    if (this.leftTex !== null) this.leftUnder.style.backgroundImage = this.bg(this.leftTex, 'right');
  }

  private frontOf = new WeakMap<Flight, Tex>();
  private backOf = new WeakMap<Flight, Tex>();

  private onStart(f: Flight): void {
    if (f.final) {
      this.frontOf.set(f, this.rightTex);
      this.backOf.set(f, 'blank');
      this.rightTex = 'blank';
    } else {
      const c = this.texCursor;
      this.frontOf.set(f, (c % 3) as Tex);
      this.backOf.set(f, ((c + 2) % 3) as Tex);
      this.texCursor = c + 1;
      this.rightTex = ((c + 1) % 3) as Tex;
    }
    const slot = this.pages.find((p) => p.flight === null);
    if (slot) {
      slot.flight = f;
      this.assignPageTextures(slot, f);
      slot.el.style.display = 'block';
    }
    this.applyUnderTextures();
  }

  private onLand(f: Flight): void {
    this.leftTex = this.backOf.get(f) ?? 'blank';
    const slot = this.pages.find((p) => p.flight === f);
    if (slot) {
      slot.flight = null;
      slot.el.style.display = 'none';
    }
    this.applyUnderTextures();
  }

  private assignPageTextures(p: PageEl, f: Flight): void {
    p.front.style.backgroundImage = this.bg(this.frontOf.get(f) ?? 0, 'left');
    p.back.style.backgroundImage = this.bg(this.backOf.get(f) ?? 'blank', 'right');
  }

  private frame(now: number): void {
    fpsMeter.mark(now);
    if (this.seekT === null) this.scheduler.tick(now);
    this.render();
    if (this.scheduler.phase === 'settled' && !this.visible) this.driver?.stop();
  }

  private render(): void {
    if (!this.geometry) return;
    const single = this.geometry.mode === 'single';
    for (const p of this.pages) {
      const f = p.flight;
      if (!f) continue;
      const t = f.t;
      const e = (f.final ? easeFinal : easeInOutCubic)(t);
      const phi = Math.PI * e;
      const deg = (phi * 180) / Math.PI;
      // 前 30% 进度加轻微 skewY，模拟页角先起的弯曲
      const skew = -1.4 * Math.sin(Math.PI * clamp(t / 0.3, 0, 1)) * (1 - e);
      p.el.style.transform = `rotateY(${(-deg).toFixed(3)}deg) skewY(${skew.toFixed(3)}deg)`;
      // 在右侧时先翻的页在上；越过 90° 后后翻的页在上。只在越过 90° 时写
      const z = String(deg < 90 ? 5000 - f.seq : 1000 + f.seq);
      if (z !== p.zIndex) p.el.style.zIndex = p.zIndex = z;
      // 单页模式左侧没有书页：越过 100° 开始淡出，160° 完全透明（与封面一致）
      const o = single ? (1 - smoothstep(100, 160, deg)).toFixed(3) : '1';
      if (o !== p.opacity) p.el.style.opacity = p.opacity = o;

      const s = Math.abs(Math.sin(phi));
      // 正面法线 (−sin φ, 0, cos φ)，背面相反
      const bFront = brightness(-Math.sin(phi), Math.cos(phi));
      const bBack = brightness(Math.sin(phi), -Math.cos(phi));
      applyShade(p.frontShade, bFront, s);
      applyShade(p.backShade, bBack, s);
    }
    // 起翻的页在右侧底页靠书脊处投下的影子
    if (this.rightShadow) {
      let k = 0;
      for (const p of this.pages) {
        const f = p.flight;
        if (!f) continue;
        const e = (f.final ? easeFinal : easeInOutCubic)(f.t);
        if (e < 0.5) k = Math.max(k, Math.sin(Math.PI * e) * 0.9);
      }
      this.rightShadow.style.opacity = k.toFixed(3);
    }
  }

  private seek(t: number | null): void {
    if (!this.root || !this.driver) return;
    if (t === null) {
      this.seekT = null;
      return;
    }
    this.driver.stop();
    this.seekT = clamp(t, 0, 1);
    this.texCursor = 0;
    this.rightTex = 1;
    this.leftTex = 2;
    for (const p of this.pages) {
      p.flight = null;
      p.el.style.display = 'none';
    }
    const [first] = this.pages;
    if (first) {
      const f: Flight = {
        seq: 0,
        start: 0,
        duration: 1,
        theta0: 0.19,
        rMaxRatio: 0.23,
        final: false,
        t: this.seekT,
      };
      this.frontOf.set(f, 0);
      this.backOf.set(f, 2);
      first.flight = f;
      this.assignPageTextures(first, f);
      first.el.style.display = 'block';
    }
    this.applyUnderTextures();
    this.root.style.opacity = '1';
    this.visible = true;
    this.render();
  }
}
