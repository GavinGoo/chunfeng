// 品质档位（16 §3.12，D31）：full（默认）与 lite。减少动态效果另有自己的分支，不属于档位。
// - 启动时：弱机（与选 CSS 引擎同一判定），或本次会话已降档（sessionStorage）→ lite；
// - 运行时：首次翻页起翻 300 ms 后的 2 s 内平均帧率低于 50 fps → 本次会话降为 lite，在书进入 open / closed 时才应用，
//   不在翻页途中切换；
// - ?tier=lite | full 强制档位（测试与评审用）；其次是 localStorage 的 chunfeng:perf-tier-override（E2E 用它固定为 full：
//   无头浏览器是软件渲染，首次翻页本来就低于 50 fps）。
// lite：关闭微粒，两层亮星停在 0.8，不渲染光幕，墨迹显现与淡去只做透明度，背景时钟降到 20 Hz；
// 星旋、星盘、星空漂移与北斗闪烁照常（D30）。

import { useSyncExternalStore } from 'react';
import { STORAGE_KEYS, safeGet, safeSet } from './storage';

export type PerfTier = 'full' | 'lite';
export type PerfTierReason = 'override' | 'low-end' | 'slow-flip';

/** 弱机：核心数 ≤ 2 或内存 ≤ 2 GB（翻页也因此选 CSS 引擎，09 §8） */
export function isLowEnd(nav: { hardwareConcurrency?: number; deviceMemory?: number }): boolean {
  const cores = nav.hardwareConcurrency;
  const mem = nav.deviceMemory;
  return (typeof cores === 'number' && cores > 0 && cores <= 2) || (typeof mem === 'number' && mem <= 2);
}

export function parseTierOverride(search: string): PerfTier | null {
  const v = new URLSearchParams(search).get('tier');
  return v === 'lite' || v === 'full' ? v : null;
}

export interface PerfTierEnv {
  cores?: number;
  memory?: number;
  /** location.search */
  search?: string;
  /** localStorage 中的强制档位 */
  stored?: string | null;
  /** 本次会话已降档 */
  downgraded?: boolean;
}

/** 启动时的档位 */
export function detectPerfTier(env: PerfTierEnv): { tier: PerfTier; reasons: PerfTierReason[] } {
  const stored = env.stored === 'lite' || env.stored === 'full' ? env.stored : null;
  const override = parseTierOverride(env.search ?? '') ?? stored;
  if (override) return { tier: override, reasons: ['override'] };
  const reasons: PerfTierReason[] = [];
  if (isLowEnd({ hardwareConcurrency: env.cores, deviceMemory: env.memory })) reasons.push('low-end');
  if (env.downgraded) reasons.push('slow-flip');
  return { tier: reasons.length > 0 ? 'lite' : 'full', reasons };
}

// ---------------------------------------------------------------------------
// 当前档位（客户端单例）

let applied: PerfTier = 'full';
let pending: PerfTier | null = null;
let initialized = false;
let forced = false;
const listeners = new Set<() => void>();

function emit(): void {
  for (const fn of listeners) fn();
}

function init(): void {
  if (initialized || typeof window === 'undefined') return;
  initialized = true;
  const nav = navigator as Navigator & { deviceMemory?: number };
  const { tier, reasons } = detectPerfTier({
    cores: nav.hardwareConcurrency,
    memory: nav.deviceMemory,
    search: location.search,
    stored: safeGet('local', STORAGE_KEYS.perfTierOverride),
    downgraded: safeGet('session', STORAGE_KEYS.perfTier) === 'lite',
  });
  forced = reasons.includes('override');
  applied = tier;
}

/** 当前生效的档位（客户端）；组件里用 usePerfTier */
export function getPerfTier(): PerfTier {
  init();
  return applied;
}

/** 运行时降档：写入本次会话；由 applyPendingPerfTier 在书静止时应用 */
export function downgradePerfTier(_reason: 'slow-flip'): void {
  init();
  if (forced || applied === 'lite') return;
  safeSet('session', STORAGE_KEYS.perfTier, 'lite');
  pending = 'lite';
}

/** 书进入 open / closed 时调用：应用运行时降档 */
export function applyPendingPerfTier(): void {
  if (!pending) return;
  applied = pending;
  pending = null;
  emit();
}

function subscribe(fn: () => void): () => void {
  init();
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** 当前档位。服务端渲染与水合时为 full，水合后按判定更新 */
export function usePerfTier(): PerfTier {
  return useSyncExternalStore(
    subscribe,
    () => {
      init();
      return applied;
    },
    () => 'full',
  );
}

/** 测试用：重置单例 */
export function resetPerfTierForTest(): void {
  applied = 'full';
  pending = null;
  initialized = false;
  forced = false;
  firstFlipMeasured = false;
  listeners.clear();
}

// ---------------------------------------------------------------------------
// 首次翻页的帧率

export const SLOW_FLIP_FPS = 50;
const WARMUP_MS = 300;
const WINDOW_MS = 2000;

/**
 * 起翻 300 ms 后的 2 s 内统计帧率，低于 50 fps 时回调一次。窗口内页面被隐藏（帧间隔被拉长）时作废，不回调。
 */
export class FlipFpsMonitor {
  private first = -1;
  private last = -1;
  private frames = 0;
  private finished = false;

  constructor(
    private readonly start: number,
    private readonly onResult: (fps: number) => void,
  ) {}

  get done(): boolean {
    return this.finished;
  }

  frame(now: number): void {
    if (this.finished || now < this.start + WARMUP_MS) return;
    if (now > this.start + WARMUP_MS + WINDOW_MS) {
      this.finished = true;
      if (this.frames >= 2 && this.last > this.first)
        this.onResult(((this.frames - 1) * 1000) / (this.last - this.first));
      return;
    }
    if (this.first < 0) this.first = now;
    this.last = now;
    this.frames++;
  }

  cancel(): void {
    this.finished = true;
  }
}

let firstFlipMeasured = false;

/** 本次页面生命周期内的首次翻页返回一个监测器（之后返回 null）；结果低于 50 fps 时降档 */
export function monitorFirstFlip(start: number): FlipFpsMonitor | null {
  if (firstFlipMeasured) return null;
  return new FlipFpsMonitor(start, (fps) => {
    firstFlipMeasured = true;
    if (fps < SLOW_FLIP_FPS) downgradePerfTier('slow-flip');
  });
}
