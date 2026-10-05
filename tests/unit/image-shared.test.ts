import { describe, expect, it } from 'vitest';
import { FULL_MAX_EDGE, FULL_MAX_PIXELS, fitWithin, IMAGE_ID_RE, isImageId } from '@/lib/shared/image';

describe('lib/shared/image（15 §4、§17）', () => {
  it('IMAGE_ID_RE：16 位字母数字', () => {
    expect(isImageId('Qm7xK2pT9cHd4Ls8')).toBe(true);
    expect(isImageId('Qm7xK2pT9cHd4Ls')).toBe(false);
    expect(isImageId('Qm7xK2pT9cHd4Ls8a')).toBe(false);
    expect(isImageId('Qm7xK2pT9cHd4L_8')).toBe(false);
    expect(isImageId('../../etc/passwd')).toBe(false);
    expect(isImageId(123)).toBe(false);
    expect(IMAGE_ID_RE.test('0123456789abcdef')).toBe(true);
  });

  const lim = { maxEdge: FULL_MAX_EDGE, maxPixels: FULL_MAX_PIXELS };

  it('不放大', () => {
    expect(fitWithin(800, 600, lim)).toEqual({ width: 800, height: 600 });
    expect(fitWithin(16, 16, lim)).toEqual({ width: 16, height: 16 });
  });

  it('同时满足长边与像素上限，结果取整', () => {
    for (const [w, h] of [
      [4032, 3024],
      [3024, 4032],
      [8000, 500],
      [500, 8000],
      [1500, 1500],
      [2048, 2048],
      [1301, 1307],
    ] as const) {
      const r = fitWithin(w, h, lim);
      expect(Number.isInteger(r.width) && Number.isInteger(r.height)).toBe(true);
      expect(Math.max(r.width, r.height)).toBeLessThanOrEqual(FULL_MAX_EDGE);
      expect(r.width * r.height).toBeLessThanOrEqual(FULL_MAX_PIXELS);
      expect(r.width).toBeLessThanOrEqual(w);
      // 保持比例（取整误差内）
      expect(Math.abs(r.width / r.height - w / h) / (w / h)).toBeLessThan(0.01);
    }
  });

  it('极宽图受长边约束；方图受像素约束', () => {
    expect(fitWithin(8000, 500, lim).width).toBe(2048);
    const sq = fitWithin(3000, 3000, lim);
    expect(sq.width).toBe(sq.height);
    expect(sq.width).toBe(Math.floor(Math.sqrt(FULL_MAX_PIXELS)));
  });

  it('非法尺寸', () => {
    expect(fitWithin(0, 10, lim)).toEqual({ width: 0, height: 0 });
    expect(fitWithin(Number.NaN, 10, lim)).toEqual({ width: 0, height: 0 });
  });
});
