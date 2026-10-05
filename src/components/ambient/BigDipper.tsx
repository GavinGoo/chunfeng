// 北斗七星（10 §2）：天璇 → 天枢的连线（指极星）在夜空中指向北极星；这里让它指向书——书即北辰。
// 坐标以天枢为原点、指极方向默认朝上；外层 CSS 绕天枢旋转，使指极线对准书心。纯装饰。

/** 七星：名称、坐标（天枢为原点）、视星等 */
const STARS = [
  { name: '天枢', x: 0, y: 0, mag: 1.8 },
  { name: '天璇', x: 5, y: 80, mag: 2.4 },
  { name: '天玑', x: 90, y: 110, mag: 2.4 },
  { name: '天权', x: 105, y: 50, mag: 3.3 },
  { name: '玉衡', x: 185, y: 55, mag: 1.8 },
  { name: '开阳', x: 245, y: 70, mag: 2.2 },
  { name: '摇光', x: 320, y: 120, mag: 1.9 },
] as const;

/** 斗魁四星闭合，斗柄三星自天权引出 */
const LINKS = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 0],
  [3, 4],
  [4, 5],
  [5, 6],
] as const;

/** 指极线：天璇 → 天枢方向延长约五倍（北极星所在），末端渐隐 */
const POINTER_END = { x: -25, y: -400 };

/** 指极方向（天璇 → 天枢）在屏幕坐标中的角度，供 CSS 旋转对准书心 */
export const DIPPER_POINTER_DEG = (Math.atan2(-80, -5) * 180) / Math.PI;

/** 逐星闪烁周期在 6.8–9.2 s 之间错开（10 §2.1），避免七星同步明暗 */
const twinklePeriod = (i: number) => 6.8 + (((i * 5) % 7) / 6) * 2.4;

export function BigDipper({ className, starClassName }: { className?: string; starClassName?: string }) {
  return (
    <svg className={className} viewBox="-40 -420 380 560" aria-hidden="true" focusable="false">
      <defs>
        <radialGradient id="dipper-star">
          <stop offset="0" style={{ stopColor: 'var(--paper-50)' }} />
          <stop offset="0.18" style={{ stopColor: 'var(--gold-100)', stopOpacity: 0.9 }} />
          <stop offset="0.45" style={{ stopColor: 'var(--gold-300)', stopOpacity: 0.22 }} />
          <stop offset="1" style={{ stopColor: 'var(--gold-300)', stopOpacity: 0 }} />
        </radialGradient>
        <linearGradient
          id="dipper-pointer"
          gradientUnits="userSpaceOnUse"
          x1="0"
          y1="0"
          x2={POINTER_END.x}
          y2={POINTER_END.y}
        >
          <stop offset="0" stopColor="currentColor" stopOpacity="0.6" />
          <stop offset="0.7" stopColor="currentColor" stopOpacity="0.25" />
          <stop offset="1" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
        {/* 焦外（10 §2.1）：连线虚化；七星本身不虚化（光点模糊后会消失） */}
        <filter id="dipper-soft" x="-10%" y="-10%" width="120%" height="120%">
          <feGaussianBlur stdDeviation="1.2" />
        </filter>
      </defs>
      <path
        d={`M0 0L${POINTER_END.x} ${POINTER_END.y}`}
        stroke="url(#dipper-pointer)"
        strokeWidth={1}
        strokeDasharray="1 7"
        strokeLinecap="round"
      />
      <g stroke="currentColor" strokeWidth={0.8} opacity={0.32} filter="url(#dipper-soft)">
        {LINKS.map(([a, b]) => {
          const s = STARS[a];
          const e = STARS[b];
          return <line key={`${a}-${b}`} x1={s.x} y1={s.y} x2={e.x} y2={e.y} />;
        })}
      </g>
      {STARS.map((s, i) => (
        <circle
          key={s.name}
          className={starClassName}
          cx={s.x}
          cy={s.y}
          r={26 - s.mag * 5}
          fill="url(#dipper-star)"
          style={{
            animationDuration: `${twinklePeriod(i).toFixed(2)}s`,
            animationDelay: `${(-i * 1.37).toFixed(2)}s`,
          }}
        />
      ))}
    </svg>
  );
}
