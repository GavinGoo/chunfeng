import { describe, expect, it } from 'vitest';
import {
  collectStaticStrings,
  fill,
  flippingHintAt,
  formatCountdown,
  formatErrorExtra,
  formatImageFailedHint,
  formatLiveImageFailed,
  formatOptionLabel,
  formatPageNo,
  formatPageTitle,
  formatPct,
  formatPhotoLabel,
  zh,
} from '@/copy/zh';
import { collectUiGlyphs } from '../../scripts/build-fonts';

describe('copy/zh 文案', () => {
  it('collectStaticStrings 收集到每一条文案（含数组与模板）', () => {
    const all = collectStaticStrings();
    expect(all).toContain(zh.cover.title);
    expect(all).toContain(zh.cover.openButton);
    for (const p of zh.cover.input.placeholders) expect(all).toContain(p);
    for (const h of zh.flipping.hints) expect(all).toContain(h.text);
    expect(all).toContain(zh.error.extra.RATE_LIMITED);
    expect(all).toContain(zh.share.scanHint);
    expect(all.every((s) => typeof s === 'string' && s.length > 0)).toBe(true);
  });

  it('文案中不使用感叹号连用与半角感叹号', () => {
    for (const s of collectStaticStrings()) {
      expect(s).not.toMatch(/！！|!/);
    }
  });

  it('fill 填充占位，缺失的变量原样保留', () => {
    expect(fill('{a} / {b}', { a: 1, b: 'x' })).toBe('1 / x');
    expect(fill('{a} {missing}', { a: 1 })).toBe('1 {missing}');
  });

  it('格式化函数', () => {
    expect(formatPageNo(237)).toBe('第 237 页');
    expect(formatPct(0)).toBe('<1%');
    expect(formatPct(44)).toBe('44%');
    expect(formatOptionLabel('B', '拿着邀约谈一次加薪', 25, false)).toBe(
      'B，拿着邀约谈一次加薪，25%，已收起',
    );
    expect(formatPageTitle()).toBe('春风');
    expect(formatPageTitle('工作三年了，要不要跳槽去创业公司？')).toBe('春风 · 工作三年了，要不要跳槽去');
    expect(formatCountdown(12_300)).toBe('13 秒后可以再试');
  });

  it('翻页提示按时长切换（07 §4）', () => {
    expect(flippingHintAt(0)).toBe('春风正在翻书……');
    expect(flippingHintAt(2999)).toBe('春风正在翻书……');
    expect(flippingHintAt(3000)).toBe('风过书页，答案渐近……');
    expect(flippingHintAt(8000)).toBe('在字里行间寻找属于你的那一页……');
    expect(flippingHintAt(60_000)).toBe('书页有些多，快找到了……');
  });

  it('错误补充句：RATE_LIMITED 带秒数，未列出的错误码不补充', () => {
    expect(formatErrorExtra('RATE_LIMITED', 4200)).toBe('春风有些应接不暇，5 秒后再试。');
    expect(formatErrorExtra('JEV_UNAVAILABLE')).toBe(zh.error.extra.JEV_UNAVAILABLE);
    expect(formatErrorExtra('BAD_REQUEST')).toBeUndefined();
  });
});

describe('UI 子集字体的字符集（06 §3.2）', () => {
  it('包含全部文案汉字、中文标点与日期用字，不含拉丁字母与数字', () => {
    const glyphs = collectUiGlyphs();
    for (const ch of '春风翻开属于你的那页亥闰') expect(glyphs).toContain(ch);
    for (const ch of '‘’“”…·—「」，。？') expect(glyphs).toContain(ch);
    expect(glyphs).not.toMatch(/[A-Za-z0-9]/);
    expect(new Set(glyphs).size).toBe([...glyphs].length);
  });
});

describe('图片提问的文案（15 §10.10）', () => {
  it('被 collectStaticStrings 收集，并进入 UI 子集字体', () => {
    const all = collectStaticStrings();
    for (const t of [
      zh.cover.image.attach,
      zh.cover.image.reasons.rateLimited,
      zh.flipping.withImageFirst,
      zh.answer.photoNote,
      zh.share.containsPhoto,
      zh.live.imageRemoved,
    ])
      expect(all).toContain(t);
    const glyphs = collectUiGlyphs();
    for (const ch of '端详夹删') expect(glyphs).toContain(ch);
  });

  it('flippingHintAt：带图时第一句改为「端详这张图」，之后不变', () => {
    expect(flippingHintAt(0, { withImage: true })).toBe('春风正在端详这张图……');
    expect(flippingHintAt(2999, { withImage: true })).toBe('春风正在端详这张图……');
    expect(flippingHintAt(3000, { withImage: true })).toBe(flippingHintAt(3000));
    expect(flippingHintAt(0)).toBe('春风正在翻书……');
  });

  it('附图失败的提示与播报、相片的无障碍名称', () => {
    expect(formatImageFailedHint('tooLarge')).toBe('图片太大了，换一张小一些的吧，轻触缩略图重试');
    expect(formatImageFailedHint('rateLimited', 12_000)).toBe('附图有些频繁，12 秒后再试，轻触缩略图重试');
    expect(formatLiveImageFailed('network')).toBe('图片没能附上：图片没能送到，再试一次吧');
    expect(formatPhotoLabel('两件外套')).toBe('放大查看图片：两件外套');
    expect(formatPhotoLabel('  ')).toBe('放大查看图片：提问者附上的图片');
  });
});
