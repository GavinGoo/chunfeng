import { describe, expect, it } from 'vitest';
import {
  COVER_DURATION_MS,
  coverKeyframes,
  cubicBezier,
  EASE_PAGE,
  singleModeFadeOffsets,
  timeForProgress,
} from '@/components/book/CoverMotion';
import {
  diffGlyphs,
  HOLD_MS,
  insertPaste,
  isSubmitEnter,
  nextPlaceholderIndex,
  sanitizeTyped,
  shouldShowCounter,
  stepTypewriter,
  TYPE_MS,
  type TypewriterState,
} from '@/components/book/QuestionPlateLogic';

describe('封面开合动效（08 §6）', () => {
  const ease = cubicBezier(...EASE_PAGE);

  it('--ease-page 端点正确、单调、不回弹', () => {
    expect(ease(0)).toBe(0);
    expect(ease(1)).toBe(1);
    let prev = 0;
    for (let t = 0; t <= 1.0001; t += 0.01) {
      const v = ease(Math.min(1, t));
      expect(v).toBeGreaterThanOrEqual(prev - 1e-9);
      expect(v).toBeLessThanOrEqual(1);
      prev = v;
    }
  });

  it('timeForProgress 是缓动的反函数', () => {
    for (const p of [0.1, 0.5, 0.9]) expect(ease(timeForProgress(ease, p))).toBeCloseTo(p, 4);
  });

  it('单页模式在 100°–160° 间淡出', () => {
    const { start, end } = singleModeFadeOffsets();
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    expect(end).toBeLessThan(1);
    expect(ease(start) * 180).toBeCloseTo(100, 1);
    expect(ease(end) * 180).toBeCloseTo(160, 1);
    expect(COVER_DURATION_MS).toBe(1100);
  });

  it('关键帧：双页只旋转；单页附带淡出；合上反向', () => {
    const spread = coverKeyframes('spread', true);
    expect(spread.fade).toBeUndefined();
    expect(spread.rotate.at(-1)?.transform).toBe('rotateY(-180deg)');
    const open = coverKeyframes('single', true);
    expect(open.fade?.at(-1)?.opacity).toBe(0);
    const close = coverKeyframes('single', false);
    expect(close.rotate.at(-1)?.transform).toBe('rotateY(0deg)');
    expect(close.fade?.[0]?.opacity).toBe(0);
    expect(close.fade?.at(-1)?.opacity).toBe(1);
  });
});

describe('输入铭牌（08 §2）', () => {
  it('占位符循环轮换', () => {
    expect(nextPlaceholderIndex(0, 4)).toBe(1);
    expect(nextPlaceholderIndex(3, 4)).toBe(0);
    expect(nextPlaceholderIndex(0, 0)).toBe(0);
  });

  it('占位符打字机：打完 → 停留 → 退格到空 → 下一句', () => {
    const lengths = [3, 2];
    let s: TypewriterState = { index: 0, shown: 0, phase: 'typing' };
    const trace: string[] = [];
    let first = 0;
    for (let n = 0; n < 12; n++) {
      const step = stepTypewriter(s, lengths);
      if (n === 0) first = step.delay;
      s = step.state;
      trace.push(`${s.index}:${s.shown}:${s.phase[0]}`);
      if (s.phase === 'holding') expect(step.delay).toBe(HOLD_MS);
    }
    expect(first).toBe(TYPE_MS);
    expect(trace).toEqual([
      '0:1:t',
      '0:2:t',
      '0:3:h',
      '0:3:e',
      '0:2:e',
      '0:1:e',
      '1:0:t',
      '1:1:t',
      '1:2:h',
      '1:2:e',
      '1:1:e',
      '0:0:t',
    ]);
  });

  it('输入浮现：只有新写入的字拿到新元数据', () => {
    let n = 0;
    const make = (offset: number) => ({ id: n++, offset });
    const a = diffGlyphs([], [], ['要', '不'], make);
    expect(a.map((g) => g.offset)).toEqual([0, 1]);
    // 末尾追加
    const b = diffGlyphs(['要', '不'], a, ['要', '不', '要'], make);
    expect(b.slice(0, 2)).toEqual(a);
    expect(b[2]?.id).toBe(2);
    // 中间替换（输入法定字：拼音换成汉字）
    const c = diffGlyphs(
      ['要', 'h', 'u', '不'],
      [a[0], { id: 7, offset: 0 }, { id: 8, offset: 1 }, a[1]],
      ['要', '换', '不'],
      make,
    );
    expect(c[0]).toBe(a[0]);
    expect(c[2]).toBe(a[1]);
    expect(c[1]?.id).toBe(3);
    // 删除
    expect(diffGlyphs(['要', '不', '要'], b, ['要', '要'], make)).toEqual([b[0], b[2]]);
    // 重复字：对齐到前缀
    const d = diffGlyphs(
      ['a', 'a'],
      [
        { id: 90, offset: 0 },
        { id: 91, offset: 0 },
      ],
      ['a', 'a', 'a'],
      make,
    );
    expect(d.map((g) => g.id)).toEqual([90, 91, 4]);
  });

  it('计数自 160 字起显示', () => {
    expect(shouldShowCounter(159)).toBe(false);
    expect(shouldShowCounter(160)).toBe(true);
  });

  it('Enter 在输入法组合中不提交', () => {
    expect(isSubmitEnter({ key: 'Enter', isComposing: false, keyCode: 13 })).toBe(true);
    expect(isSubmitEnter({ key: 'Enter', isComposing: true, keyCode: 13 })).toBe(false);
    expect(isSubmitEnter({ key: 'Enter', isComposing: false, keyCode: 229 })).toBe(false);
    expect(isSubmitEnter({ key: 'a', isComposing: false, keyCode: 65 })).toBe(false);
  });

  it('键入：换行改为空格，按字素簇截断到 200', () => {
    expect(sanitizeTyped('要不要\n换工作').value).toBe('要不要 换工作');
    const long = '👨‍👩‍👧'.repeat(210);
    const r = sanitizeTyped(long);
    expect(r.truncated).toBe(true);
    expect(r.value).toBe('👨‍👩‍👧'.repeat(200));
  });

  it('粘贴：规范化空白并插入选区，超长时截断并给出提示', () => {
    const r = insertPaste('今晚该不该？', 2, 2, '  \n 向 TA\t表白 ');
    expect(r.value).toBe('今晚向 TA 表白该不该？');
    expect(r.caret).toBe(2 + '向 TA 表白'.length);
    expect(r.truncated).toBe(false);

    const t = insertPaste('前后', 1, 1, '字'.repeat(300));
    expect(t.truncated).toBe(true);
    expect(t.value).toBe(`前${'字'.repeat(198)}后`);
  });
});
