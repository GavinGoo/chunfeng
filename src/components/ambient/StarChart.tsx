// 星盘（10 §2）：以书为中心缓慢旋转的烫金细线星图——刻度环、二十八宿（按古度分宫）、四象、偏心的黄道圈。
// 纯装饰：静态 SVG，由外层 CSS 控制尺寸、不透明度与旋转；文字取自 zh.ambient，已收录进 UI 子集字体。

import { zh } from '@/copy/zh';

/** 二十八宿古度（合计 365），与 zh.ambient.mansions 一一对应 */
const WIDTHS = [
  [12, 9, 15, 5, 5, 18, 11],
  [26, 8, 12, 10, 17, 16, 9],
  [16, 12, 14, 11, 16, 2, 9],
  [33, 4, 15, 7, 18, 18, 17],
] as const;
const TOTAL = 365;

const R_OUTER = 492;
const R_TICK = 480;
const R_MANSION_OUT = 452;
const R_MANSION_IN = 400;
const R_NAME = 426;
const R_SYMBOL = 380;
const R_INNER = 360;

/** 角度 0 指向正上方，逆时针为正（星图从下往上看天） */
function polar(r: number, deg: number): [number, number] {
  const a = ((-deg - 90) * Math.PI) / 180;
  return [r * Math.cos(a), r * Math.sin(a)];
}

const fmt = (n: number) => n.toFixed(1);

function line(r0: number, r1: number, deg: number): string {
  const [x0, y0] = polar(r0, deg);
  const [x1, y1] = polar(r1, deg);
  return `M${fmt(x0)} ${fmt(y0)}L${fmt(x1)} ${fmt(y1)}`;
}

/** 外环刻度：每度一短刻，每 10 度一长刻 */
const TICKS = Array.from({ length: 360 }, (_, i) =>
  line(i % 10 === 0 ? R_TICK - 8 : R_TICK, R_OUTER, i),
).join('');

interface Mansion {
  name: string;
  start: number;
  mid: number;
}

const { mansions: MANSION_NAMES, symbols: SYMBOLS } = zh.ambient;

const MANSIONS: Mansion[] = [];
const QUADRANTS: { name: string; mid: number }[] = [];
{
  let acc = 0;
  MANSION_NAMES.forEach((group, g) => {
    const groupStart = acc;
    group.forEach((name, i) => {
      const w = ((WIDTHS[g]?.[i] ?? 0) * 360) / TOTAL;
      MANSIONS.push({ name, start: acc, mid: acc + w / 2 });
      acc += w;
    });
    QUADRANTS.push({ name: SYMBOLS[g] ?? '', mid: (groupStart + acc) / 2 });
  });
}

const DIVIDERS = MANSIONS.map((m) => line(R_MANSION_IN, R_MANSION_OUT, m.start)).join('');
/** 四象分界：从内圈贯穿到刻度环 */
const QUADRANT_LINES = MANSIONS.filter((_, i) => i % 7 === 0)
  .map((m) => line(R_INNER, R_TICK, m.start))
  .join('');

export function StarChart({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="-500 -500 1000 1000" aria-hidden="true" focusable="false">
      {/* 轻微虚化：退到远处，不与书争清晰度。滤镜在 SVG 内部，随图层栅格化一次，旋转时不重算 */}
      <defs>
        <filter id="star-chart-soft" x="-5%" y="-5%" width="110%" height="110%">
          <feGaussianBlur stdDeviation="0.9" />
        </filter>
      </defs>
      <g filter="url(#star-chart-soft)">
        <g fill="none" stroke="currentColor">
          <circle r={R_OUTER} strokeWidth={1.4} />
          <circle r={R_TICK} strokeWidth={0.6} />
          <path d={TICKS} strokeWidth={0.6} />
          <circle r={R_MANSION_OUT} strokeWidth={0.8} />
          <circle r={R_MANSION_IN} strokeWidth={1} />
          <path d={DIVIDERS} strokeWidth={0.7} />
          <path d={QUADRANT_LINES} strokeWidth={0.5} strokeDasharray="1 5" />
          <circle r={R_INNER} strokeWidth={0.5} strokeDasharray="2 7" />
          {/* 黄道：相对天极偏心的一圈 */}
          <circle cx={0} cy={46} r={318} strokeWidth={0.6} strokeDasharray="10 6 2 6" />
        </g>
        <g fill="currentColor" textAnchor="middle" dominantBaseline="central">
          {MANSIONS.map((m) => {
            const [x, y] = polar(R_NAME, m.mid);
            return (
              <text
                key={m.name}
                x={fmt(x)}
                y={fmt(y)}
                fontSize={21}
                transform={`rotate(${fmt(-m.mid)} ${fmt(x)} ${fmt(y)})`}
              >
                {m.name}
              </text>
            );
          })}
          {QUADRANTS.map((q) => {
            const [x, y] = polar(R_SYMBOL, q.mid);
            return (
              <text
                key={q.name}
                x={fmt(x)}
                y={fmt(y)}
                fontSize={12}
                letterSpacing={6}
                opacity={0.7}
                transform={`rotate(${fmt(-q.mid)} ${fmt(x)} ${fmt(y)})`}
              >
                {q.name}
              </text>
            );
          })}
        </g>
      </g>
    </svg>
  );
}
