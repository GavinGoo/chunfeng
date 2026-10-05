// 提问时间格式化：公历、农历、时辰（11 §1）。服务端与客户端共用，保证 SSR 与水合一致。

export const DEFAULT_TZ = 'Asia/Shanghai';

export function isValidTimeZone(tz: unknown): tz is string {
  if (typeof tz !== 'string' || tz.length === 0 || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function safeTz(tz: string): string {
  return isValidTimeZone(tz) ? tz : DEFAULT_TZ;
}

interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

export function wallClock(date: Date, tz: string): WallClock {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: safeTz(tz),
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour') % 24,
    minute: get('minute'),
  };
}

const pad = (n: number) => String(n).padStart(2, '0');

/** 2026年9月27日 21:40 */
export function formatGregorian(date: Date, tz: string): string {
  const w = wallClock(date, tz);
  return `${w.year}年${w.month}月${w.day}日 ${pad(w.hour)}:${pad(w.minute)}`;
}

/** 2026.09.27 21:40（分享图） */
export function formatCompact(date: Date, tz: string): string {
  const w = wallClock(date, tz);
  return `${w.year}.${pad(w.month)}.${pad(w.day)} ${pad(w.hour)}:${pad(w.minute)}`;
}

const SHICHEN = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥'] as const;

/** 子 23–1、丑 1–3 …… 亥 21–23 */
export function shichen(hour: number): string {
  const idx = Math.floor((((hour % 24) + 24 + 1) % 24) / 2);
  return `${SHICHEN[idx]}时`;
}

const DAY_TENS = ['初', '十', '廿', '三'] as const;
const DIGITS = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'] as const;

export function lunarDayName(day: number): string {
  if (day === 10) return '初十';
  if (day === 20) return '二十';
  if (day === 30) return '三十';
  const tens = Math.floor(day / 10);
  const ones = day % 10;
  return `${DAY_TENS[tens]}${DIGITS[ones]}`;
}

function lunarMonthName(raw: string): string {
  const leap = raw.startsWith('闰');
  const name = raw
    .replace(/^闰/, '')
    .replace(/^一月$/, '正月')
    .replace(/^十一月$/, '冬月')
    .replace(/^十二月$/, '腊月');
  return `${leap ? '闰' : ''}${name}`;
}

/** 丙午年八月十七；环境不支持农历时返回 null */
export function formatLunar(date: Date, tz: string): string | null {
  try {
    const parts = new Intl.DateTimeFormat('zh-CN-u-ca-chinese', {
      timeZone: safeTz(tz),
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    }).formatToParts(date);
    const yearName = parts.find((p) => (p.type as string) === 'yearName')?.value;
    const month = parts.find((p) => p.type === 'month')?.value;
    const day = Number(parts.find((p) => p.type === 'day')?.value);
    if (!yearName || !month || !Number.isInteger(day) || day < 1 || day > 30) return null;
    return `${yearName}年${lunarMonthName(month)}${lunarDayName(day)}`;
  } catch {
    return null;
  }
}

/** 丙午年八月十七 · 亥时 */
export function formatLunarWithShichen(date: Date, tz: string): string | null {
  const lunar = formatLunar(date, tz);
  if (!lunar) return null;
  return `${lunar} · ${shichen(wallClock(date, tz).hour)}`;
}
