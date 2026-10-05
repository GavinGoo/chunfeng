// 背景时钟（16 §3.8）：约 30 Hz 的共用节拍。背景的 CSS 动画由它推进 currentTime，微粒在同一拍里绘制，
// 整屏的合成从屏幕刷新率降到约 30 次/s。计时器等到约 33 ms 之后，再用 rAF 对齐垂直同步；
// 只在 rAF 里跳过绘制的话，主线程仍会每帧被唤醒。页面隐藏时停止，回到前台从当前时刻继续，不补算。

/** 每拍回调：dt 为距上一拍的秒数（已截断） */
export type AmbientTick = (dt: number) => void;

/** 节拍间隔：约 30 Hz；品质档位 lite 降到 20 Hz（16 §3.12） */
export const TICK_MS = 1000 / 30;
let tickMs = TICK_MS;
/** 计时器的提前量：留给计时器的抖动，到点后再由 rAF 对齐到下一个垂直同步 */
const TICK_SLACK_MS = 4;
/** 单拍的上限（s）：卡顿后不一次跳太远 */
export const MAX_DT = 0.1;

const subscribers = new Set<AmbientTick>();
let raf = 0;
let timer = 0;
let last = 0;

function frame(now: number): void {
  raf = 0;
  const dt = Math.min(Math.max(now - last, 0) / 1000, MAX_DT);
  last = now;
  for (const tick of subscribers) tick(dt);
  timer = window.setTimeout(
    () => {
      timer = 0;
      raf = requestAnimationFrame(frame);
    },
    Math.max(0, tickMs - (performance.now() - now) - TICK_SLACK_MS),
  );
}

function start(): void {
  if (raf || timer || document.hidden || subscribers.size === 0) return;
  last = performance.now();
  raf = requestAnimationFrame(frame);
}

function stop(): void {
  cancelAnimationFrame(raf);
  clearTimeout(timer);
  raf = 0;
  timer = 0;
}

const onVisibility = () => (document.hidden ? stop() : start());

/** 设定节拍频率（Hz），下一拍起生效 */
export function setAmbientClockHz(hz: number): void {
  tickMs = 1000 / hz;
}

/** 订阅节拍；返回退订函数。最后一个订阅者退订时时钟停止 */
export function subscribeAmbientClock(tick: AmbientTick): () => void {
  if (subscribers.size === 0) document.addEventListener('visibilitychange', onVisibility);
  subscribers.add(tick);
  start();
  return () => {
    if (!subscribers.delete(tick) || subscribers.size > 0) return;
    stop();
    document.removeEventListener('visibilitychange', onVisibility);
  };
}
