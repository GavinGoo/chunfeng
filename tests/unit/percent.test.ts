import { describe, expect, it } from 'vitest';
import { formatPct, toPercents } from '@/lib/shared/percent';
import { seeded } from '@/server/mock/faults';

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

describe('toPercents（最大余数法）', () => {
  it('文档示例：51 / 15 / 28 / 6', () => {
    expect(toPercents([0.507, 0.149, 0.281, 0.062])).toEqual([51, 15, 28, 6]);
  });

  it('极端分布 (1,0,0,0)', () => {
    expect(toPercents([1, 0, 0, 0])).toEqual([100, 0, 0, 0]);
  });

  it('完全并列：差额按原始顺序分配', () => {
    expect(toPercents([1 / 3, 1 / 3, 1 / 3])).toEqual([34, 33, 33]);
    expect(toPercents([0.25, 0.25, 0.25, 0.25])).toEqual([25, 25, 25, 25]);
  });

  it('小数部分并列时概率大者优先', () => {
    // 0.505 与 0.305 的小数部分相同（0.5），差额 1 给概率更大的一项
    const out = toPercents([0.305, 0.505, 0.19]);
    expect(sum(out)).toBe(100);
    expect(out).toEqual([30, 51, 19]);
  });

  it('极小概率：取整为 0，展示为「<1%」', () => {
    const out = toPercents([0.996, 0.002, 0.001, 0.001]);
    expect(out).toEqual([100, 0, 0, 0]);
    expect(formatPct(out[1]!, 0.002)).toBe('<1%');
    expect(formatPct(0, 0)).toBe('0%');
    expect(formatPct(44, 0.44)).toBe('44%');
  });

  it('未归一化、非法值与全零输入仍然和为 100', () => {
    expect(sum(toPercents([2, 1, 1]))).toBe(100);
    expect(toPercents([Number.NaN, -1, 1, 0])).toEqual([0, 0, 100, 0]);
    expect(toPercents([0, 0, 0, 0])).toEqual([25, 25, 25, 25]);
    expect(toPercents([])).toEqual([]);
  });

  it('随机性质测试（1,000 组）：和恒为 100、每项与 p·100 相差 < 1、保持顺序', () => {
    const rand = seeded(20260927);
    for (let n = 0; n < 1000; n++) {
      const len = 2 + Math.floor(rand() * 5);
      const raw = Array.from({ length: len }, () => (rand() < 0.15 ? 0 : rand() ** 3));
      const total = sum(raw);
      const out = toPercents(raw);
      expect(sum(out)).toBe(100);
      out.forEach((pct, i) => {
        expect(Number.isInteger(pct)).toBe(true);
        expect(pct).toBeGreaterThanOrEqual(0);
        const exact = total > 0 ? (raw[i]! / total) * 100 : 100 / len;
        expect(Math.abs(pct - exact)).toBeLessThan(1);
      });
      // 概率严格更大者，百分比不会更小
      for (let i = 0; i < len; i++) {
        for (let j = 0; j < len; j++) {
          if (raw[i]! > raw[j]! + 1e-9) expect(out[i]!).toBeGreaterThanOrEqual(out[j]!);
        }
      }
    }
  });
});
