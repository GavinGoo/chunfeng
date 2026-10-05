import { describe, expect, it } from 'vitest';
import { photoTilt, singlePhotoBox } from '@/components/answer/photoStyle';
import { computeRevealPlan, INK } from '@/components/answer/reveal';

const ids = Array.from({ length: 400 }, (_, i) => `id${String(i).padStart(10, '0')}`);

describe('photoTilt（15 §11.2）', () => {
  it('同一 id 稳定；倾斜绝对值在规定范围内', () => {
    for (const id of ids) {
      const s = photoTilt(id, 'single');
      expect(photoTilt(id, 'single')).toBe(s);
      expect(Math.abs(s)).toBeGreaterThanOrEqual(1);
      expect(Math.abs(s)).toBeLessThanOrEqual(3);
      const sp = photoTilt(id, 'spread');
      expect(Math.abs(sp)).toBeGreaterThanOrEqual(1);
      expect(Math.abs(sp)).toBeLessThanOrEqual(2);
    }
  });

  it('不同 id 分布均匀：左右倾斜大致各半，角度覆盖整个区间', () => {
    const tilts = ids.map((id) => photoTilt(id, 'single'));
    const left = tilts.filter((t) => t < 0).length;
    expect(left / tilts.length).toBeGreaterThan(0.4);
    expect(left / tilts.length).toBeLessThan(0.6);
    const mags = tilts.map(Math.abs);
    expect(Math.min(...mags)).toBeLessThan(1.2);
    expect(Math.max(...mags)).toBeGreaterThan(2.8);
  });

  it('竖屏相片外框：高 72 / 56 px，宽限制在 56–96 px', () => {
    expect(singlePhotoBox({ width: 4, height: 3 }, false)).toEqual({ width: 93, height: 72 });
    expect(singlePhotoBox({ width: 3000, height: 500 }, false)).toEqual({ width: 96, height: 72 });
    expect(singlePhotoBox({ width: 500, height: 3000 }, false)).toEqual({ width: 56, height: 72 });
    expect(singlePhotoBox({ width: 1, height: 1 }, true).height).toBe(56);
  });
});

describe('显现时间表：带图（15 §11.3）', () => {
  const base = { chars: 16, items: 4, hasFill: true, hasSeal: true, hasHint: false } as const;

  it('提问显现后 100 ms 显影 600 ms，随后相角 200 ms，之后分割线与其余顺延', () => {
    const plain = computeRevealPlan({ ...base, mode: 'single' });
    const p = computeRevealPlan({ ...base, mode: 'single', hasPhoto: true });
    expect(p.photo).toEqual({ start: p.question.end + 100, dur: 600 });
    expect(p.corners).toEqual({ start: p.photo!.start + 600, dur: 200 });
    expect(p.rule.start).toBe(p.corners!.start + p.corners!.dur + INK.ruleGap);
    const shift = INK.photoGap + INK.photoDur + INK.cornerDur;
    expect(p.items[0]!.start - plain.items[0]!.start).toBe(shift);
    expect(p.actionsCue - plain.actionsCue).toBe(shift);
    expect(plain.photo).toBeNull();
    expect(plain.corners).toBeNull();
  });
});
