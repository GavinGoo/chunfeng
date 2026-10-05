'use client';

// 背景氛围（10）：「北辰居中，众星共之」——书是宇宙中心的北极星，星旋与星盘绕它缓缓转动，北斗指向它。
// 全部在书之后，任何时刻都不抢书的注意力。
//   L0 深空基底与暗角 · L1 书后金色光晕与书缘溢光 · L2 星旋与星空（远景 + 两层呼吸的亮星）· L3 星盘与北斗
//   · L4′ 焦外暗角 · L4 风中微粒（Canvas）· L5 颗粒
// 景深（10 §2.1）：镜头对焦在书上，背景各层越远越虚、越暗；L4′ 盖在星图之上、微粒之下，把画面四周压下去。
//
// 接口：<AmbientBackground intensity="calm" | "active" bookRect={…} settled />
// - intensity：平静态 / 活跃态（opening、flipping、settling 时为 active），两者之间 800 ms 平滑插值；
// - bookRect：书所在矩形（视口 CSS px）。光晕、星旋、星盘以它的中心为圆心，北斗指向它；其中的微粒不透明度 ×0.3。
// 减少动态效果：不创建画布，L1、L2 保持静态，强度不再变化。
// 资源占用（16）：星盘的旋转挂在外层 div 上（§3.1）；强度过渡的不透明度交给合成器（§3.5）；
// 无限循环的旋转、漂移与闪烁由背景时钟约 30 Hz 推进（§3.8）。
// 品质档位 lite（§3.12）：不画微粒，两层亮星停在 0.8，时钟降到 20 Hz；运行时降档时微粒与亮星 600 ms 淡到 lite 的状态。

import {
  type CSSProperties,
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { type PerfTier, usePerfTier } from '@/lib/client/perfTier';
import styles from './AmbientBackground.module.css';
import { BigDipper, DIPPER_POINTER_DEG } from './BigDipper';
import { setAmbientClockHz, subscribeAmbientClock } from './clock';
import {
  ACTIVE_GAIN,
  type AmbientIntensity,
  easeInOut,
  gainAt,
  INTENSITY_TRANSITION_MS,
  intensityLevel,
  interpolateLevel,
} from './intensity';
import { ParticleField, type ParticleSeek } from './ParticleField';
import { isFewCores, type Rect } from './particles';
import { StarChart } from './StarChart';

export interface AmbientBackgroundProps {
  intensity?: AmbientIntensity;
  bookRect?: Rect;
  /** 书处于静止状态（合上或打开后）：背景的循环动画交给背景时钟（16 §3.8）。默认 true */
  settled?: boolean;
}

/** 开发与测试钩子（16 §5.3）：把背景的全部动画（含微粒）冻结在第 t 秒，供逐像素对照；null 恢复运行 */
export interface AmbientDevHook {
  seek(t: number | null): void;
}

declare global {
  interface Window {
    __ambient?: AmbientDevHook;
  }
}

const IS_DEV = process.env.NODE_ENV !== 'production';

const REDUCED_QUERY = '(prefers-reduced-motion: reduce)';

const noopSubscribe = () => () => undefined;

/** 运行时降档时，微粒与亮星淡到 lite 状态的时长 */
const LITE_FADE_MS = 600;

/**
 * 品质档位（16 §3.12）。返回实际生效的档位与「正在淡出到 lite」：
 * 运行时由 full 降为 lite 时先淡出 600 ms（这段时间仍按 full 渲染微粒与亮星），结束后再切换；
 * 启动时就是 lite 的（弱机、本次会话已降档）直接按 lite 渲染。水合那一次由服务端的 full 变为客户端的值，不算运行时降档。
 */
function useAmbientTier(): { tier: PerfTier; fading: boolean; endFade: () => void } {
  const tier = usePerfTier();
  const hydrated = useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
  const [prev, setPrev] = useState({ tier, hydrated });
  const [fading, setFading] = useState(false);
  if (prev.tier !== tier || prev.hydrated !== hydrated) {
    if (prev.hydrated && prev.tier === 'full' && tier === 'lite') setFading(true);
    setPrev({ tier, hydrated });
  }
  const endFade = useCallback(() => setFading(false), []);
  return { tier: fading ? 'full' : tier, fading, endFade };
}

function subscribeReduced(onChange: () => void): () => void {
  const mql = window.matchMedia(REDUCED_QUERY);
  mql.addEventListener('change', onChange);
  return () => mql.removeEventListener('change', onChange);
}

/** 服务端渲染时按「减少动态效果」处理：不输出画布，水合后再决定 */
export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeReduced,
    () => window.matchMedia(REDUCED_QUERY).matches,
    () => true,
  );
}

/** 随强度变化的不透明度：平静态（L = 0）与活跃态（L = 1）的值，中间线性（10 §2） */
interface LevelFade {
  ref: RefObject<HTMLElement | null>;
  calm: number;
  active: number;
}

/** 过渡的关键帧数：按缓入缓出的曲线取样，段间线性插值（与曲线的偏差 < 0.3%） */
const FADE_STEPS = 12;

/**
 * 强度控制器：把 calm / active 平滑插值为 0–1 的 level（800 ms），不触发 React 渲染。
 * - level 每帧写入 levelRef（微粒速度）与漂移动画的播放速率；
 * - 随强度变化的不透明度交给合成器：过渡开始时为每个元素起一段 WAAPI 动画，过渡中不重算样式、不重绘（16 §3.5）。
 *   不再写继承的 CSS 变量：那会让整个背景子树每帧重算样式，书缘溢光的大阴影每帧重绘。
 */
function useAmbientController(
  intensity: AmbientIntensity,
  rootRef: RefObject<HTMLDivElement | null>,
  fades: readonly LevelFade[],
  reduced: boolean,
) {
  const levelRef = useRef(intensityLevel(intensity));
  const running = useRef<Animation[]>([]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const opacityAt = (f: LevelFade, level: number) => f.calm + (f.active - f.calm) * level;
    const setLevel = (level: number) => {
      levelRef.current = level;
      const rate = gainAt(level, ACTIVE_GAIN.mistDrift);
      for (const anim of root.getAnimations({ subtree: true })) {
        if (anim instanceof CSSAnimation && anim.animationName.includes('drift')) anim.playbackRate = rate;
      }
    };
    const cancelFades = () => {
      for (const a of running.current) a.cancel();
      running.current = [];
    };
    /** 直接落到某个强度，不过渡 */
    const settle = (level: number) => {
      cancelFades();
      for (const f of fades) {
        const el = f.ref.current;
        if (el) el.style.opacity = opacityAt(f, level).toFixed(4);
      }
      setLevel(level);
    };
    if (reduced) {
      settle(0);
      return;
    }
    const from = levelRef.current;
    const to = intensityLevel(intensity);
    if (from === to) {
      settle(to);
      return;
    }
    // 过渡中途再次切换时，从当前强度接着过渡
    cancelFades();
    for (const f of fades) {
      const el = f.ref.current;
      if (!el) continue;
      const frames = Array.from({ length: FADE_STEPS + 1 }, (_, i) => ({
        offset: i / FADE_STEPS,
        opacity: opacityAt(f, from + (to - from) * easeInOut(i / FADE_STEPS)),
      }));
      // 终值先写进内联样式：动画播完（或被取消）后停在终值
      el.style.opacity = opacityAt(f, to).toFixed(4);
      running.current.push(el.animate(frames, { duration: INTENSITY_TRANSITION_MS }));
    }
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const elapsed = now - start;
      if (elapsed < INTENSITY_TRANSITION_MS) {
        setLevel(interpolateLevel(from, to, elapsed));
        raf = requestAnimationFrame(tick);
      } else settle(to);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [intensity, reduced, rootRef, fades]);

  return levelRef;
}

/** 由背景时钟推进的 CSS 动画：旋转与漂移（drift-*）、亮星呼吸（glint）、北斗闪烁（twinkle） */
const CLOCKED = /drift|glint|twinkle/;

/**
 * 背景时钟（16 §3.8）：把背景里无限循环的 CSS 动画暂停，每拍按 dt × playbackRate 推进 currentTime。
 * 关键帧、缓动、负延迟与强度的播放速率都沿用 CSS 与控制器，运动与原来逐项一致，只是整屏合成降到约 30 次/s。
 * 光晕呼吸（breathe）只在活跃态由 animation-play-state 开关，不接管：对 CSS 动画调用 pause() 后 play-state 不再起作用。
 * 只在书静止时接管：开合、翻页与显现时屏幕本来就按刷新率更新，时钟省不下什么，
 * 反而每拍的动画提交会与这些时刻的主线程工作挤在一起，让显现偶尔掉帧。此时交还合成器播放，暂停与播放都保留 currentTime，不跳变。
 * frozenRef 为真时（开发钩子 seek）不推进。
 */
function useClockedAnimations(
  rootRef: RefObject<HTMLDivElement | null>,
  reduced: boolean,
  settled: boolean,
  frozenRef: RefObject<boolean>,
) {
  useEffect(() => {
    const root = rootRef.current;
    if (!root || reduced || !settled) return;
    let clocked = root
      .getAnimations({ subtree: true })
      .filter(
        (a): a is CSSAnimation =>
          a instanceof CSSAnimation && CLOCKED.test(a.animationName) && a.playState === 'running',
      );
    for (const a of clocked) a.pause();
    const unsubscribe = subscribeAmbientClock((dt) => {
      if (frozenRef.current) return;
      // 样式改为 animation: none 后动画变为 idle：此时再写 currentTime 会让它复活，所以先剔除
      if (clocked.some((a) => a.playState === 'idle'))
        clocked = clocked.filter((a) => a.playState !== 'idle');
      for (const a of clocked) a.currentTime = (Number(a.currentTime) || 0) + dt * 1000 * a.playbackRate;
    });
    return () => {
      unsubscribe();
      for (const a of clocked) if (a.playState === 'paused') a.play();
    };
  }, [rootRef, reduced, settled, frozenRef]);
}

export function AmbientBackground({ intensity = 'calm', bookRect, settled = true }: AmbientBackgroundProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const nebulaRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<HTMLDivElement>(null);
  const auraBreathRef = useRef<HTMLDivElement>(null);
  const rimActiveRef = useRef<HTMLDivElement>(null);
  const fades = useMemo<LevelFade[]>(
    () => [
      { ref: nebulaRef, calm: 0.52, active: 0.68 },
      { ref: chartRef, calm: 0.3, active: 0.4 },
      { ref: auraBreathRef, calm: 0, active: 1 },
      { ref: rimActiveRef, calm: 0, active: 1 },
    ],
    [],
  );
  const reduced = usePrefersReducedMotion();
  const { tier, fading: liteFading, endFade } = useAmbientTier();
  const lite = tier === 'lite';

  useEffect(() => {
    setAmbientClockHz(lite ? 20 : 30);
  }, [lite]);

  // 运行时降为 lite：微粒画布与两层亮星从当前的不透明度淡到 lite 的状态（微粒 0，亮星 0.8），结束后再切换档位
  useEffect(() => {
    const root = rootRef.current;
    if (!liteFading || !root) return;
    const fades: Animation[] = [];
    const canvas = root.querySelector('canvas');
    if (canvas)
      fades.push(
        canvas.animate([{ opacity: 1 }, { opacity: 0 }], { duration: LITE_FADE_MS, fill: 'forwards' }),
      );
    for (const g of root.querySelectorAll<HTMLElement>(`.${styles.glint}`)) {
      const from = getComputedStyle(g).opacity;
      fades.push(
        g.animate([{ opacity: from }, { opacity: 0.8 }], { duration: LITE_FADE_MS, fill: 'forwards' }),
      );
    }
    let done = false;
    void Promise.all(fades.map((a) => a.finished)).then(
      () => {
        done = true;
        endFade();
      },
      () => undefined,
    );
    return () => {
      // 档位切换后亮星由 CSS 停在 0.8、微粒画布卸载，此时再撤掉淡出动画，不闪
      if (done) for (const a of fades) a.cancel();
    };
  }, [liteFading, endFade]);
  const levelRef = useAmbientController(intensity, rootRef, fades, reduced);

  // 核心数 ≤ 4：亮星 B 层不做呼吸动画（与微粒减半同一判定）
  useEffect(() => {
    if (isFewCores(navigator.hardwareConcurrency)) rootRef.current?.setAttribute('data-few-cores', '');
  }, []);

  const clockFrozenRef = useRef(false);
  useClockedAnimations(rootRef, reduced, settled, clockFrozenRef);

  const particleSeekRef = useRef<ParticleSeek | null>(null);
  useEffect(() => {
    const root = rootRef.current;
    if (!IS_DEV || !root) return;
    // 只暂停原本在运行的动画，恢复时也只恢复它们：对 CSS 动画调用 pause() / play() 后，
    // animation-play-state 就不再起作用，由 CSS 暂停的动画（如平静态的光晕呼吸）不能碰。
    // 由背景时钟推进的动画本来就是暂停的，只需让时钟停止推进
    const paused = new Set<Animation>();
    const hook: AmbientDevHook = {
      seek(t) {
        clockFrozenRef.current = t !== null;
        if (t === null) {
          for (const anim of paused) anim.play();
          paused.clear();
        } else {
          for (const anim of root.getAnimations({ subtree: true })) {
            if (anim.playState === 'running') {
              anim.pause();
              paused.add(anim);
            }
            anim.currentTime = t * 1000;
          }
        }
        particleSeekRef.current?.(t);
      },
    };
    window.__ambient = hook;
    return () => {
      if (window.__ambient === hook) window.__ambient = undefined;
    };
  }, []);

  // 书心与书的宽高（视口 CSS px）；未知时用视口中心
  const center: Record<string, string> = bookRect
    ? {
        '--cx': `${(bookRect.x + bookRect.w / 2).toFixed(1)}px`,
        '--cy': `${(bookRect.y + bookRect.h / 2).toFixed(1)}px`,
        '--bw': `${bookRect.w.toFixed(1)}px`,
        '--bh': `${bookRect.h.toFixed(1)}px`,
      }
    : {};

  return (
    <div
      ref={rootRef}
      className={styles.root}
      style={{ ...center, '--dipper-offset': `${DIPPER_POINTER_DEG.toFixed(2)}deg` } as CSSProperties}
      aria-hidden="true"
      data-intensity={intensity}
      data-tier={tier}
      data-testid="ambient"
    >
      <div className={styles.base} />
      <div ref={nebulaRef} className={styles.nebula}>
        <div className={styles.vortex} />
      </div>
      <div className={styles.stars}>
        <div className={styles.starsFar} />
        <div className={`${styles.glint} ${styles.glintA}`} />
        <div className={`${styles.glint} ${styles.glintB}`} />
      </div>
      <div className={styles.aura}>
        <div ref={auraBreathRef} className={styles.auraBreath} />
      </div>
      <div className={styles.rim} />
      <div ref={rimActiveRef} className={styles.rimActive} />
      <div ref={chartRef} className={styles.chart}>
        <StarChart className={styles.chartSvg} />
      </div>
      <div className={styles.dipper}>
        <BigDipper className={styles.dipperSvg} starClassName={styles.dipperStar} />
      </div>
      <div className={styles.vignette} />
      {reduced || lite ? null : (
        <ParticleField
          levelRef={levelRef}
          bookRect={bookRect}
          className={styles.particles}
          seekRef={particleSeekRef}
        />
      )}
      <div className={styles.grain} />
    </div>
  );
}
