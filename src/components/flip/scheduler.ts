/**
 * 循环翻页调度器（09 §5），CSS 与 WebGL 引擎共用。
 *
 * 纯逻辑、不依赖 DOM：由引擎在每帧调用 `tick(now)` 推进，时间由调用方注入，
 * 因此可以用假时钟做单元测试。内部时间 = 外部时间 − 累计暂停时长（页面隐藏期间不计时）。
 */

import { type FlipFpsMonitor, monitorFirstFlip } from '@/lib/client/perfTier';
import { clamp, DURATION_JITTER, lerp, RMAX_RANGE, THETA0_RANGE } from './curl';

export interface Rhythm {
  /** 第一页时长 */
  firstDuration: number;
  /** 第一页起翻到第二页起翻的间隔 */
  firstInterval: number;
  /** 稳定节奏：单页基准时长 */
  duration: number;
  /** 稳定节奏：起页基准间隔 */
  interval: number;
  /** 起页间隔的随机倍率 */
  intervalJitter: readonly [number, number];
  /** 单页时长的随机倍率 */
  durationJitter: readonly [number, number];
  /** 同时在空中的页数上限 */
  maxInAir: number;
  /** 最短循环时长 */
  minLoopMs: number;
  /** 最少页数 */
  minPages: number;
  /** 收尾最后一页时长 */
  finalDuration: number;
  /** 相邻两页落下的最小间隔，避免后翻的页追上先翻的页 */
  minLandGap: number;
  theta0Range: readonly [number, number];
  /** Rmax / W */
  rMaxRange: readonly [number, number];
}

export const DEFAULT_RHYTHM: Rhythm = {
  firstDuration: 1000,
  firstInterval: 560,
  duration: 760,
  interval: 420,
  intervalJitter: [0.9, 1.1],
  durationJitter: DURATION_JITTER,
  maxInAir: 3,
  minLoopMs: 2400,
  minPages: 3,
  finalDuration: 1200,
  minLandGap: 140,
  theta0Range: THETA0_RANGE,
  rMaxRange: RMAX_RANGE,
};

export interface Flight {
  /** 本轮循环内的序号（0 起） */
  readonly seq: number;
  /** 内部时间下的起翻时刻 */
  readonly start: number;
  readonly duration: number;
  readonly theta0: number;
  /** Rmax 相对页宽的比例 */
  readonly rMaxRatio: number;
  /** 收尾页（背面为空白纸，缓动更柔和） */
  readonly final: boolean;
  /** 最近一次 tick 时的进度 0..1 */
  t: number;
}

export interface SchedulerHooks {
  /** 一页起翻：引擎在此把右侧底页换成下一页的纹理 */
  onStart?: (f: Flight) => void;
  /** 一页落下：引擎在此把左侧底页换成它的背面纹理 */
  onLand?: (f: Flight) => void;
  /** 收尾完成：左右底页均为空白 */
  onSettled?: () => void;
}

export interface StopOptions {
  minLoopMs?: number;
  minPages?: number;
}

export type SchedulerPhase = 'idle' | 'looping' | 'draining' | 'final' | 'settled';

export interface SchedulerOptions {
  rhythm?: Partial<Rhythm>;
  /** 可注入的随机数源（测试用） */
  random?: () => number;
}

export class FlipScheduler {
  rhythm: Rhythm;
  private readonly random: () => number;
  private readonly hooks: SchedulerHooks;

  private _phase: SchedulerPhase = 'idle';
  private flights: Flight[] = [];
  private seq = 0;
  private regularStarted = 0;
  private loopStart = 0;
  private nextStartAt = 0;
  private lastEnd = Number.NEGATIVE_INFINITY;

  private pausedAt: number | null = null;
  private pausedTotal = 0;

  private stopRequested = false;
  private stopMin: Required<StopOptions> = { minLoopMs: 0, minPages: 0 };
  private settleWaiters: Array<() => void> = [];
  private settlePromise: Promise<void> | null = null;

  constructor(hooks: SchedulerHooks = {}, opts: SchedulerOptions = {}) {
    this.hooks = hooks;
    this.rhythm = { ...DEFAULT_RHYTHM, ...opts.rhythm };
    this.random = opts.random ?? Math.random;
  }

  get phase(): SchedulerPhase {
    return this._phase;
  }

  get paused(): boolean {
    return this.pausedAt !== null;
  }

  /** 本轮已起翻的常规页数（不含收尾页） */
  get pagesStarted(): number {
    return this.regularStarted;
  }

  /** 当前在空中的页（按起翻顺序） */
  get inAir(): readonly Flight[] {
    return this.flights;
  }

  /** 本轮已循环的时长（不含暂停） */
  loopElapsed(now: number): number {
    if (this._phase === 'idle') return 0;
    return this.local(now) - this.loopStart;
  }

  /** 开始循环：立即起翻第一页 */
  start(now: number): void {
    this.reset();
    this._phase = 'looping';
    const T = this.local(now);
    this.loopStart = T;
    this.launch(T, false);
  }

  /** 单独翻一页（前进/后退恢复答案时使用），落在空白纸上 */
  flipOnce(now: number): Promise<void> {
    this.reset();
    this._phase = 'final';
    const T = this.local(now);
    this.loopStart = T;
    this.stopRequested = true;
    const p = this.makeSettlePromise();
    this.launch(T, true);
    return p;
  }

  /**
   * 请求收尾（09 §5 stop 流程 1–4）：
   * 1. 继续正常起页，直到「已循环 ≥ minLoopMs 且已翻 ≥ minPages」
   * 2. 停止起新页，等空中的页全部落下
   * 3. 起最后一页（背面为空白纸）
   * 4. 落下后 resolve
   */
  stop(now: number, opts: StopOptions = {}): Promise<void> {
    if (this._phase === 'idle' || this._phase === 'settled') return Promise.resolve();
    if (!this.stopRequested) {
      this.stopRequested = true;
      this.stopMin = {
        minLoopMs: opts.minLoopMs ?? this.rhythm.minLoopMs,
        minPages: opts.minPages ?? this.rhythm.minPages,
      };
    }
    const p = this.makeSettlePromise();
    if (!this.paused) this.tick(now);
    return p;
  }

  /** 页面隐藏：暂停计时 */
  pause(now: number): void {
    if (this.pausedAt === null) this.pausedAt = now;
  }

  /**
   * 页面重新可见：继续计时。若已请求收尾，把空中的页直接落下并进入收尾，
   * 不补播被错过的翻页（最短时长与最少页数的要求在此豁免）。
   */
  resume(now: number): void {
    if (this.pausedAt === null) return;
    this.pausedTotal += Math.max(0, now - this.pausedAt);
    this.pausedAt = null;
    if (!this.stopRequested) return;
    if (this._phase === 'looping' || this._phase === 'draining' || this._phase === 'final') {
      const wasFinal = this._phase === 'final';
      for (const f of this.flights) {
        f.t = 1;
        this.hooks.onLand?.(f);
      }
      this.flights = [];
      if (wasFinal) {
        this.settle();
      } else {
        this._phase = 'final';
        this.launch(this.local(now), true);
      }
    }
  }

  /** 推进到 now，返回当前在空中的页 */
  tick(now: number): readonly Flight[] {
    if (this.paused) return this.flights;
    if (this._phase === 'idle' || this._phase === 'settled') return this.flights;
    const T = this.local(now);

    // 更新进度，按起翻顺序落下
    let landedFinal = false;
    const remaining: Flight[] = [];
    for (const f of this.flights) {
      f.t = clamp((T - f.start) / f.duration, 0, 1);
      if (f.t >= 1) {
        this.hooks.onLand?.(f);
        if (f.final) landedFinal = true;
      } else {
        remaining.push(f);
      }
    }
    this.flights = remaining;

    if (this._phase === 'looping') {
      if (this.stopConditionsMet(T)) {
        this._phase = 'draining';
      } else if (T >= this.nextStartAt) {
        if (this.flights.length < this.rhythm.maxInAir) {
          // 一帧最多起一页；帧被严重延迟时不补播，从当前时刻起翻
          this.launch(Math.max(this.nextStartAt, T - 34), false);
        }
      }
    }
    if (this._phase === 'draining' && this.flights.length === 0) {
      this._phase = 'final';
      this.launch(T, true);
      return this.flights;
    }
    if (this._phase === 'final' && landedFinal && this.flights.length === 0) {
      this.settle();
    }
    return this.flights;
  }

  // -------------------------------------------------------------------------

  private local(now: number): number {
    const pausing = this.pausedAt === null ? 0 : now - this.pausedAt;
    return now - this.pausedTotal - Math.max(0, pausing);
  }

  private stopConditionsMet(T: number): boolean {
    return (
      this.stopRequested &&
      T - this.loopStart >= this.stopMin.minLoopMs &&
      this.regularStarted >= this.stopMin.minPages
    );
  }

  private pick(range: readonly [number, number]): number {
    return lerp(range[0], range[1], this.random());
  }

  private launch(start: number, final: boolean): void {
    const r = this.rhythm;
    const first = !final && this.regularStarted === 0;
    let duration = final
      ? r.finalDuration
      : first
        ? r.firstDuration
        : r.duration * this.pick(r.durationJitter);
    // 不允许后翻的页追上先翻的页
    if (this.flights.length > 0 && start + duration < this.lastEnd + r.minLandGap) {
      duration = this.lastEnd + r.minLandGap - start;
    }
    const f: Flight = {
      seq: this.seq++,
      start,
      duration,
      theta0: this.pick(r.theta0Range),
      rMaxRatio: this.pick(r.rMaxRange),
      final,
      t: 0,
    };
    this.lastEnd = start + duration;
    this.flights.push(f);
    if (!final) {
      this.regularStarted++;
      const gap = first ? r.firstInterval : r.interval * this.pick(r.intervalJitter);
      this.nextStartAt = start + gap;
    }
    this.hooks.onStart?.(f);
  }

  private makeSettlePromise(): Promise<void> {
    if (!this.settlePromise) {
      this.settlePromise = new Promise<void>((resolve) => {
        this.settleWaiters.push(resolve);
      });
    }
    return this.settlePromise;
  }

  private settle(): void {
    this._phase = 'settled';
    this.flights = [];
    this.hooks.onSettled?.();
    const waiters = this.settleWaiters;
    this.settleWaiters = [];
    this.settlePromise = null;
    for (const w of waiters) w();
  }

  private reset(): void {
    this.flights = [];
    this.seq = 0;
    this.regularStarted = 0;
    this.lastEnd = Number.NEGATIVE_INFINITY;
    this.stopRequested = false;
    this.stopMin = { minLoopMs: 0, minPages: 0 };
    // 旧的等待者（例如被新一轮 start 打断的 stop）直接放行，避免永远挂起
    const waiters = this.settleWaiters;
    this.settleWaiters = [];
    this.settlePromise = null;
    for (const w of waiters) w();
  }
}

// ---------------------------------------------------------------------------
// 帧驱动：rAF + visibilitychange，两种引擎共用

export interface FrameClock {
  now(): number;
  request(cb: (now: number) => void): number;
  cancel(id: number): void;
}

export const browserClock: FrameClock = {
  now: () => performance.now(),
  request: (cb) => requestAnimationFrame(cb),
  cancel: (id) => cancelAnimationFrame(id),
};

/**
 * 在 active 期间每帧调用 onFrame；页面隐藏时暂停 rAF 并通知调度器，重新可见时恢复。
 */
export class FrameDriver {
  private raf: number | null = null;
  private active = false;
  /** 首次循环翻页的帧率监测（16 §3.12）：低于 50 fps 时本次会话降为 lite */
  private fps: FlipFpsMonitor | null = null;
  private readonly onVisibility = () => {
    const now = this.clock.now();
    if (document.hidden) {
      this.fps?.cancel();
      this.scheduler?.pause(now);
      this.cancel();
    } else {
      this.scheduler?.resume(now);
      if (this.active) this.loop();
    }
  };

  constructor(
    private readonly clock: FrameClock,
    private readonly onFrame: (now: number) => void,
    private readonly scheduler?: FlipScheduler,
  ) {
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', this.onVisibility);
  }

  get running(): boolean {
    return this.active;
  }

  start(): void {
    this.active = true;
    if (this.scheduler && !this.fps) this.fps = monitorFirstFlip(this.clock.now());
    if (typeof document !== 'undefined' && document.hidden) {
      this.scheduler?.pause(this.clock.now());
      return;
    }
    if (this.raf === null) this.loop();
  }

  stop(): void {
    this.active = false;
    this.fps?.cancel();
    this.fps = null;
    this.cancel();
  }

  destroy(): void {
    this.stop();
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', this.onVisibility);
  }

  private cancel(): void {
    if (this.raf !== null) {
      this.clock.cancel(this.raf);
      this.raf = null;
    }
  }

  private loop(): void {
    this.cancel();
    const step = (now: number) => {
      this.raf = null;
      if (!this.active) return;
      this.fps?.frame(now);
      this.onFrame(now);
      if (this.active && this.raf === null) this.raf = this.clock.request(step);
    };
    this.raf = this.clock.request(step);
  }
}
