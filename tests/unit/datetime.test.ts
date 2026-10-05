import { describe, expect, it } from 'vitest';
import {
  formatCompact,
  formatGregorian,
  formatLunar,
  formatLunarWithShichen,
  isValidTimeZone,
  lunarDayName,
  shichen,
} from '@/lib/shared/datetime';

const SH = 'Asia/Shanghai';

describe('datetime（11 §1）', () => {
  it('时区换算', () => {
    const d = new Date('2026-09-27T13:40:00Z');
    expect(formatGregorian(d, SH)).toBe('2026年9月27日 21:40');
    expect(formatGregorian(d, 'America/New_York')).toBe('2026年9月27日 09:40');
    expect(formatCompact(d, SH)).toBe('2026.09.27 21:40');
    // 非法时区回退 Asia/Shanghai
    expect(formatGregorian(d, 'Mars/Olympus')).toBe('2026年9月27日 21:40');
  });

  it('isValidTimeZone', () => {
    expect(isValidTimeZone('Asia/Shanghai')).toBe(true);
    expect(isValidTimeZone('UTC')).toBe(true);
    expect(isValidTimeZone('Nope/Nope')).toBe(false);
    expect(isValidTimeZone('')).toBe(false);
    expect(isValidTimeZone(42)).toBe(false);
  });

  it('农历（文档示例）', () => {
    expect(formatLunarWithShichen(new Date('2026-09-27T13:40:00Z'), SH)).toBe('丙午年八月十七 · 亥时');
  });

  it('闰月', () => {
    expect(formatLunar(new Date('2025-08-01T04:00:00Z'), SH)).toBe('乙巳年闰六月初八');
    expect(formatLunar(new Date('2025-07-24T04:00:00Z'), SH)).toBe('乙巳年六月三十');
  });

  it('跨年（除夕 → 正月初一），且按提问者时区计算', () => {
    expect(formatLunar(new Date('2026-02-16T04:00:00Z'), SH)).toBe('乙巳年腊月廿九');
    expect(formatLunar(new Date('2026-02-17T04:00:00Z'), SH)).toBe('丙午年正月初一');
    expect(formatLunar(new Date('2026-02-17T04:00:00Z'), 'America/New_York')).toBe('乙巳年腊月廿九');
  });

  it('子时跨日：23 点与 0 点都是子时，日期按民用日历', () => {
    expect(formatLunarWithShichen(new Date('2026-02-16T15:30:00Z'), SH)).toBe('乙巳年腊月廿九 · 子时');
    expect(formatLunarWithShichen(new Date('2026-02-16T16:30:00Z'), SH)).toBe('丙午年正月初一 · 子时');
    expect(formatGregorian(new Date('2026-02-16T16:30:00Z'), SH)).toBe('2026年2月17日 00:30');
  });

  it('时辰换算', () => {
    expect(shichen(23)).toBe('子时');
    expect(shichen(0)).toBe('子时');
    expect(shichen(1)).toBe('丑时');
    expect(shichen(2)).toBe('丑时');
    expect(shichen(11)).toBe('午时');
    expect(shichen(12)).toBe('午时');
    expect(shichen(21)).toBe('亥时');
    expect(shichen(22)).toBe('亥时');
  });

  it('农历日名', () => {
    expect([1, 10, 11, 20, 21, 29, 30].map(lunarDayName)).toEqual([
      '初一',
      '初十',
      '十一',
      '二十',
      '廿一',
      '廿九',
      '三十',
    ]);
  });
});
