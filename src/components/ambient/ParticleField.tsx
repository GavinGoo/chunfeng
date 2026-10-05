'use client';

// L3 风中微粒（10 §3、§4）：Canvas 2D，预渲染光点，DPR 上限 1.5，页面隐藏时暂停。
// 跟随背景时钟约 30 Hz 绘制（16 §3.6、§3.8）：每步位移不到一个半像素，光点是柔光，看不出步进。
// 减少动态效果时由 AmbientBackground 直接不渲染本组件。

import { type RefObject, useEffect, useRef } from 'react';
import { subscribeAmbientClock } from './clock';
import { ACTIVE_GAIN, gainAt } from './intensity';
import { bookFactor, ParticleSystem, particleCount, type Rect, twinkle } from './particles';

/** 冻结到第 t 秒（null 恢复运行），供开发与测试钩子 window.__ambient.seek 使用（16 §5.3） */
export type ParticleSeek = (t: number | null) => void;

export interface ParticleFieldProps {
  /** 当前强度（0 = calm，1 = active），由 AmbientBackground 每帧更新，不经过 React 渲染 */
  levelRef: RefObject<number>;
  /** 书所在矩形（视口 CSS px）；其中的微粒不透明度 ×0.3 */
  bookRect?: Rect;
  className?: string;
  /** 由本组件写入冻结函数（开发与测试环境） */
  seekRef?: RefObject<ParticleSeek | null>;
}

/** 冻结时从初始状态按固定步长积分，保证同一视口下画面确定 */
const SEEK_STEP = 1 / 60;

const DPR_CAP = 1.5;
const SPRITE = 16;
const TINTS = ['227, 200, 138', '183, 220, 200'] as const; // --gold-300、--jade-300

function makeSprite(rgb: string): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = SPRITE;
  c.height = SPRITE;
  const ctx = c.getContext('2d');
  if (ctx) {
    const h = SPRITE / 2;
    const g = ctx.createRadialGradient(h, h, 0, h, h, h);
    g.addColorStop(0, `rgba(${rgb}, 1)`);
    g.addColorStop(0.25, `rgba(${rgb}, 0.65)`);
    g.addColorStop(1, `rgba(${rgb}, 0)`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, SPRITE, SPRITE);
  }
  return c;
}

export function ParticleField({ levelRef, bookRect, className, seekRef }: ParticleFieldProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const bookRef = useRef<Rect | undefined>(bookRect);
  useEffect(() => {
    bookRef.current = bookRect;
  }, [bookRect]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const sprites = TINTS.map(makeSprite);
    let system = new ParticleSystem();
    const cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency : undefined;
    let width = 0;
    let height = 0;
    let dpr = 1;

    const resize = () => {
      width = window.innerWidth;
      height = window.innerHeight;
      dpr = Math.min(window.devicePixelRatio || 1, DPR_CAP);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      system.resize(width, height, particleCount(width, height, cores));
    };
    resize();

    let time = 0;
    /** 被开发钩子冻结：不订阅时钟，直到钩子恢复 */
    let frozen = false;

    const speed = () => gainAt(levelRef.current ?? 0, ACTIVE_GAIN.particleSpeed);

    const draw = () => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      const book = bookRef.current;
      for (const p of system.particles) {
        const alpha = twinkle(p, time) * bookFactor(p.x, p.y, book);
        if (alpha <= 0.005) continue;
        ctx.globalAlpha = alpha;
        // 光点本体直径 1–2.5 px，精灵图带柔光晕，绘制尺寸取直径的 4 倍
        const d = p.size * 2 * 4;
        const sprite = sprites[p.tint];
        if (sprite) ctx.drawImage(sprite, p.x - d / 2, p.y - d / 2, d, d);
      }
      ctx.globalAlpha = 1;
    };

    // dt 由时钟截断：切回前台或卡顿后不会一次积分过长；页面隐藏时时钟停止
    const tick = (dt: number) => {
      time += dt;
      system.step(dt, time, speed());
      draw();
    };
    let unsubscribe: (() => void) | null = null;
    const start = () => {
      if (!unsubscribe && !frozen) unsubscribe = subscribeAmbientClock(tick);
    };
    const stop = () => {
      unsubscribe?.();
      unsubscribe = null;
    };

    if (seekRef) {
      seekRef.current = (t) => {
        if (t === null) {
          frozen = false;
          start();
          return;
        }
        frozen = true;
        stop();
        // 从初始状态按固定步长积分到 t：同一视口、同一种子，画面相同
        system = new ParticleSystem();
        system.resize(width, height, particleCount(width, height, cores));
        time = 0;
        while (time + SEEK_STEP <= t) {
          time += SEEK_STEP;
          system.step(SEEK_STEP, time, speed());
        }
        draw();
      };
    }

    let resizeRaf = 0;
    const onResize = () => {
      cancelAnimationFrame(resizeRaf);
      resizeRaf = requestAnimationFrame(resize);
    };

    window.addEventListener('resize', onResize);
    start();

    return () => {
      stop();
      if (seekRef) seekRef.current = null;
      cancelAnimationFrame(resizeRaf);
      window.removeEventListener('resize', onResize);
    };
  }, [levelRef, seekRef]);

  return <canvas ref={canvasRef} className={className} />;
}
