/**
 * 翻页引擎选择（09 §8）。
 *
 * 优先级：`?flip=webgl|css|reduced` 强制 → prefers-reduced-motion → WebGL2 不可用 / 低端设备 → CSS
 * → 加载 WebGL 引擎（含 three.js 的懒加载 chunk），超时则本次退回 CSS（后台继续加载，供下次使用）。
 *
 * WebGL 引擎被包在 FallbackEngine 中：上下文丢失时自动在同一层内换成 CSS 引擎并延续循环/收尾，
 * 状态机不感知差异。
 */

import type { BookGeometry } from '@/components/book/geometry';
import { isLowEnd } from '@/lib/client/perfTier';
import { CssFlipEngine } from './CssFlipEngine';
import { IS_DEV, prefersReducedMotion } from './common';
import { ReducedMotionEngine } from './ReducedMotionEngine';
import { getPageTextures } from './textures';
import type { FlipEngine, FlipEngineKind } from './types';

export interface EngineEnv {
  override: FlipEngineKind | null;
  reducedMotion: boolean;
  webgl: boolean;
  lowEnd: boolean;
}

/** 纯函数：根据环境决定引擎种类（不含加载超时的降级） */
export function chooseEngineKind(env: EngineEnv): FlipEngineKind {
  if (env.override === 'reduced') return 'reduced';
  if (env.override === 'css') return 'css';
  if (env.override === 'webgl') return env.webgl ? 'webgl' : 'css';
  if (env.reducedMotion) return 'reduced';
  if (!env.webgl || env.lowEnd) return 'css';
  return 'webgl';
}

export function parseOverride(search: string): FlipEngineKind | null {
  const v = new URLSearchParams(search).get('flip');
  return v === 'webgl' || v === 'css' || v === 'reduced' ? v : null;
}

/** 低端设备：hardwareConcurrency ≤ 2 或 deviceMemory ≤ 2 */
// 弱机判定与品质档位 lite 共用（16 §3.12）
export { isLowEnd };

let webglProbe: { strict: boolean; ok: boolean } | null = null;

/**
 * 探测 WebGL2（three.js r163 起只支持 WebGL2）。
 * strict = true 时要求非软件渲染（failIfMajorPerformanceCaveat），用于自动选择。
 */
export function probeWebGL(strict: boolean): boolean {
  if (typeof document === 'undefined') return false;
  if (webglProbe && webglProbe.strict === strict) return webglProbe.ok;
  let ok = false;
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2', { failIfMajorPerformanceCaveat: strict });
    ok = !!gl;
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
  } catch {
    ok = false;
  }
  webglProbe = { strict, ok };
  return ok;
}

type WebGLModule = typeof import('./WebGLCurlEngine');
let webglModule: Promise<WebGLModule> | null = null;

function loadWebGLModule(): Promise<WebGLModule> {
  if (!webglModule) {
    webglModule = import('./WebGLCurlEngine');
    webglModule.catch(() => {
      webglModule = null;
    });
  }
  return webglModule;
}

function requestIdle(cb: () => void): void {
  const w = globalThis as typeof globalThis & {
    requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
  };
  if (typeof w.requestIdleCallback === 'function') w.requestIdleCallback(cb, { timeout: 3000 });
  else setTimeout(cb, 200);
}

/** 用户开启了省流量（Save-Data） */
function saveData(): boolean {
  const nav = (typeof navigator === 'undefined' ? {} : navigator) as { connection?: { saveData?: boolean } };
  return nav.connection?.saveData === true;
}

/**
 * 预加载：WebGL 引擎 chunk（含 three.js）与纸页纹理，在下一次空闲时进行。有提问意图时调用一次即可（16 §3.10），
 * 重复调用无副作用。省流量时不预生成纹理（翻页开始时再生成）。
 */
export function preloadFlipEngine(geometry?: BookGeometry): void {
  if (typeof window === 'undefined') return;
  requestIdle(() => {
    const kind = chooseEngineKind(detectEnv());
    if (kind === 'webgl') void loadWebGLModule().catch(() => undefined);
    if (kind !== 'reduced' && geometry && !saveData())
      void getPageTextures(geometry.page.w, geometry.page.h).catch(() => undefined);
  });
}

export function detectEnv(search?: string): EngineEnv {
  const override = parseOverride(search ?? (typeof location === 'undefined' ? '' : location.search));
  const nav = (typeof navigator === 'undefined' ? {} : navigator) as {
    hardwareConcurrency?: number;
    deviceMemory?: number;
  };
  return {
    override,
    reducedMotion: prefersReducedMotion(),
    // 强制 webgl 时放宽为「能创建上下文即可」（便于无 GPU 的 CI 截图）；自动选择时拒绝软件渲染
    webgl: override === 'reduced' || override === 'css' ? false : probeWebGL(override !== 'webgl'),
    lowEnd: isLowEnd(nav),
  };
}

export interface SelectOptions {
  /** 覆盖 location.search（测试用） */
  search?: string;
  /** 强制引擎，优先级高于 URL */
  kind?: FlipEngineKind;
  /** three.js 加载超时（ms），默认 1100（封面打开时长 --dur-cover） */
  loadTimeoutMs?: number;
  /** 引擎降级时的通知（记录日志用） */
  onFallback?: (reason: string, from: FlipEngineKind, to: FlipEngineKind) => void;
}

export async function selectEngine(opts: SelectOptions = {}): Promise<FlipEngine> {
  const env = detectEnv(opts.search);
  if (opts.kind) env.override = opts.kind;
  if (opts.kind === 'webgl') env.webgl = probeWebGL(false);
  const kind = chooseEngineKind(env);
  maybeDebugPanel(opts.search);

  if (kind === 'reduced') return new ReducedMotionEngine();
  if (kind === 'css') return new CssFlipEngine();

  const timeout = opts.loadTimeoutMs ?? 1100;
  const mod = await Promise.race([
    loadWebGLModule().catch(() => null),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), timeout)),
  ]);
  if (!mod) {
    opts.onFallback?.('three-load-timeout', 'webgl', 'css');
    return new CssFlipEngine();
  }
  return new FallbackEngine(new mod.WebGLCurlEngine(), () => new CssFlipEngine(), opts.onFallback);
}

function maybeDebugPanel(search?: string): void {
  if (!IS_DEV || typeof window === 'undefined') return;
  const q = new URLSearchParams(search ?? location.search);
  if (q.get('debug') !== 'flip') return;
  void import('./debugPanel').then((m) => m.openDebugPanel());
}

// ---------------------------------------------------------------------------

type LoopState = 'idle' | 'looping' | 'stopping' | 'once';

/**
 * 包装一个可能失败的主引擎：主引擎报告 onFallback 时，在同一层内换成备用引擎并延续当前流程。
 */
export class FallbackEngine implements FlipEngine {
  onFallback?: (reason: string) => void;
  private current: FlipEngine;
  private switched = false;
  private layer: HTMLElement | null = null;
  private geometry: BookGeometry | null = null;
  private state: LoopState = 'idle';
  private pending: Array<{ resolve: () => void; kind: 'stop' | 'once' }> = [];
  private swapping: Promise<void> | null = null;
  private swapInProgress = false;

  constructor(
    primary: FlipEngine,
    private readonly makeFallback: () => FlipEngine,
    private readonly notify?: (reason: string, from: FlipEngineKind, to: FlipEngineKind) => void,
  ) {
    this.current = primary;
    primary.onFallback = (reason) => void this.swap(reason);
  }

  get kind(): FlipEngineKind {
    return this.current.kind;
  }

  async mount(layer: HTMLElement, geometry: BookGeometry): Promise<void> {
    this.layer = layer;
    this.geometry = geometry;
    try {
      await this.current.mount(layer, geometry);
    } catch (err) {
      // WebGL 初始化失败（例如驱动拒绝创建上下文）：直接换成备用引擎
      await this.swap(err instanceof Error ? err.message : 'mount-failed');
    }
  }

  startLoop(): void {
    this.state = 'looping';
    this.current.startLoop();
  }

  stop(opts?: { minLoopMs?: number; minPages?: number }): Promise<void> {
    this.state = 'stopping';
    // 换引擎进行中：由换引擎流程在新引擎上完成收尾
    if (this.swapInProgress) return this.track('stop', new Promise<void>(() => undefined));
    return this.track('stop', this.current.stop(opts));
  }

  flipOnce(): Promise<void> {
    this.state = 'once';
    if (this.swapInProgress) return this.track('once', new Promise<void>(() => undefined));
    return this.track('once', this.current.flipOnce());
  }

  resize(geometry: BookGeometry): void {
    this.geometry = geometry;
    this.current.resize(geometry);
  }

  fadeOut(ms?: number): Promise<void> {
    this.state = 'idle';
    return this.current.fadeOut(ms);
  }

  destroy(): void {
    this.current.destroy();
    for (const p of this.pending) p.resolve();
    this.pending = [];
  }

  /** 当前引擎的 promise 与「换引擎后由新引擎完成」两者谁先到都算完成 */
  private track(kind: 'stop' | 'once', p: Promise<void>): Promise<void> {
    return new Promise<void>((resolve) => {
      const entry = { resolve, kind };
      this.pending.push(entry);
      p.then(
        () => {
          this.pending = this.pending.filter((e) => e !== entry);
          resolve();
        },
        () => undefined,
      );
    });
  }

  private swap(reason: string): Promise<void> {
    if (this.switched) return this.swapping ?? Promise.resolve();
    this.switched = true;
    const from = this.current.kind;
    const old = this.current;
    const next = this.makeFallback();
    this.current = next;
    this.notify?.(reason, from, next.kind);
    this.onFallback?.(reason);
    this.swapInProgress = true;
    this.swapping = (async () => {
      old.destroy();
      if (!this.layer || !this.geometry) {
        this.swapInProgress = false;
        return;
      }
      await next.mount(this.layer, this.geometry);
      this.swapInProgress = false;
      const waiting = this.pending;
      this.pending = [];
      if (this.state === 'looping' || this.state === 'stopping') {
        next.startLoop();
        if (this.state === 'stopping') {
          // 旧引擎已经翻过一段，最短时长不再重新计算
          await next.stop({ minLoopMs: 0, minPages: 0 });
        }
      } else if (this.state === 'once') {
        await next.flipOnce();
      }
      for (const p of waiting) p.resolve();
    })();
    return this.swapping;
  }
}
