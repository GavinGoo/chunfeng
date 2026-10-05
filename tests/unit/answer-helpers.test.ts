import { describe, expect, it } from 'vitest';
import {
  optionAriaLabel,
  optionPctText,
  questionGlyphs,
  questionSize,
  splitPhones,
  telHref,
} from '@/components/answer/labels';
import { describeNotice } from '@/components/answer/notice';
import {
  computeRevealPlan,
  countUpValue,
  dissolveStagger,
  dustCount,
  INK,
  questionStagger,
  questionTiming,
} from '@/components/answer/reveal';
import { zh } from '@/copy/zh';
import type { ReadingOption } from '@/lib/shared/types';

const B: ReadingOption = { letter: 'B', title: '拿着邀约谈一次加薪', desc: '…', prob: 0.2507, pct: 25 };

describe('answer/labels', () => {
  it('选项的无障碍标签（11 §4.1）', () => {
    expect(optionAriaLabel(B, false)).toBe('B，拿着邀约谈一次加薪，25%，已收起');
    expect(optionAriaLabel(B, true)).toBe('B，拿着邀约谈一次加薪，25%，已展开');
  });

  it('pct = 0 显示「<1%」', () => {
    expect(optionPctText({ pct: 0, prob: 0.004 })).toBe('<1%');
    expect(optionAriaLabel({ ...B, pct: 0, prob: 0.004 }, false)).toContain('<1%');
    expect(optionPctText({ pct: 44, prob: 0.44 })).toBe('44%');
  });

  it('提问带直角引号并按字素簇拆分', () => {
    expect(questionGlyphs('去海边？')).toEqual(['「', '去', '海', '边', '？', '」']);
    expect(questionGlyphs('爱👨‍👩‍👧')).toEqual(['「', '爱', '👨‍👩‍👧', '」']);
  });

  it('提问字号档位', () => {
    expect(questionSize('工作三年了，要不要跳槽去创业公司？')).toBe('short');
    expect(questionSize('字'.repeat(40))).toBe('medium');
    expect(questionSize('字'.repeat(200))).toBe('long');
  });

  it('求助电话：拆分组合号码，tel: 只保留数字', () => {
    expect(splitPhones('110 / 120')).toEqual(['110', '120']);
    expect(splitPhones('010-82951332')).toEqual(['010-82951332']);
    expect(telHref('400-161-9995')).toBe('tel:4001619995');
    expect(telHref('+86 10 1234')).toBe('tel:+86101234');
  });
});

describe('answer/reveal 时间表（11 §5）', () => {
  it('提问：默认间隔 30 ms，字多时缩短，总时长不超过 900 ms', () => {
    expect(questionStagger(1)).toBe(0);
    expect(questionStagger(10)).toBe(INK.charStagger);
    for (const n of [2, 17, 18, 60, 202]) {
      const t = questionTiming(n);
      expect(t.end - t.start).toBeLessThanOrEqual(INK.questionCap + 1e-9);
      expect(t.stagger).toBeLessThanOrEqual(INK.charStagger);
    }
    expect(questionStagger(202)).toBeLessThan(INK.charStagger);
    const long = questionTiming(202);
    expect(long.end - long.start).toBeCloseTo(INK.questionCap);
  });

  it('竖屏：提问 → 分割线 → 选项 → 填充 → 印章 → 引导', () => {
    const p = computeRevealPlan({
      chars: 18,
      items: 4,
      hasFill: true,
      hasSeal: true,
      hasHint: true,
      mode: 'single',
    });
    expect(p.head.start).toBe(0);
    expect(p.question.start).toBe(100);
    expect(p.rule.start).toBe(p.question.end + 150);
    expect(p.items[0]?.start).toBe(p.rule.start + p.rule.dur + 100);
    expect(p.items[3]!.start - p.items[0]!.start).toBe(3 * 90);
    expect(p.fill?.start).toBe(p.items[3]!.start + 320);
    expect(p.fill?.dur).toBe(900);
    expect(p.seal?.start).toBe(p.fill!.start + 900);
    expect(p.hint?.start).toBe(p.seal!.start + 220 + 200);
    expect(p.actionsCue).toBe(p.hint!.start);
    expect(p.total).toBe(p.hint!.start + p.hint!.dur);
  });

  it('横屏：右页在左页饰纹出现后开始，比竖屏更早', () => {
    const input = { chars: 18, items: 5, hasFill: true, hasSeal: true, hasHint: false } as const;
    const single = computeRevealPlan({ ...input, mode: 'single' });
    const spread = computeRevealPlan({ ...input, mode: 'spread' });
    expect(spread.items[0]!.start).toBe(spread.rule.start + INK.spreadRightGap);
    expect(spread.items[0]!.start).toBeLessThan(single.items[0]!.start);
    expect(spread.hint).toBeNull();
  });

  it('提示页没有填充与印章', () => {
    const p = computeRevealPlan({
      chars: 10,
      items: 3,
      hasFill: false,
      hasSeal: false,
      hasHint: false,
      mode: 'single',
    });
    expect(p.fill).toBeNull();
    expect(p.seal).toBeNull();
    expect(p.actionsCue).toBe(p.items[2]!.start + INK.itemDur + INK.hintGap);
  });

  it('淡去总时长约 500 ms；百分比递增', () => {
    const n = 8;
    expect(dissolveStagger(n) * (n - 1) + INK.dissolveDur).toBeCloseTo(INK.dissolveTotal);
    expect(dissolveStagger(1)).toBe(0);
    expect(countUpValue(44, null)).toBe(0);
    expect(countUpValue(44, 0.5)).toBe(22);
    expect(countUpValue(44, 1.2)).toBe(44);
  });
});

describe('answer/reveal 金尘（11 §5.1）', () => {
  const base = { items: 4, hasFill: true, hasSeal: true, hasHint: false, mode: 'single' as const };

  it('粒数 clamp(8, round(字数 × 0.6), 18)；没有字时不生成', () => {
    expect(dustCount(0)).toBe(0);
    expect(dustCount(3)).toBe(INK.dustMin);
    expect(dustCount(20)).toBe(12);
    expect(dustCount(200)).toBe(INK.dustMax);
  });

  it('缺省种子或带图提问时不生成', () => {
    expect(computeRevealPlan({ ...base, chars: 20 }).dust).toEqual([]);
    expect(computeRevealPlan({ ...base, chars: 20, hasPhoto: true, dustSeed: 7 }).dust).toEqual([]);
  });

  it('在所选的字开始显现后 120 ms 出生，结束不晚于 total', () => {
    for (const chars of [2, 9, 30, 120]) {
      for (const mode of ['single', 'spread'] as const) {
        const plan = computeRevealPlan({ ...base, mode, chars, dustSeed: chars * 31 });
        expect(plan.dust).toHaveLength(dustCount(chars));
        for (const g of plan.dust) {
          expect(g.charIndex).toBeGreaterThanOrEqual(0);
          expect(g.charIndex).toBeLessThan(chars);
          expect(g.at).toBeCloseTo(plan.question.start + g.charIndex * plan.question.stagger + INK.dustDelay);
          expect(g.dur).toBeGreaterThan(0);
          expect(g.dur).toBeLessThanOrEqual(INK.dustDurMax);
          expect(g.at + g.dur).toBeLessThanOrEqual(plan.total);
        }
      }
    }
  });

  it('均匀抽取：字多时出生的字覆盖整句', () => {
    const { dust } = computeRevealPlan({ ...base, chars: 40, dustSeed: 1 });
    const idx = dust.map((g) => g.charIndex);
    expect(Math.min(...idx)).toBeLessThan(40 / dust.length);
    expect(Math.max(...idx)).toBeGreaterThanOrEqual(40 - 40 / dust.length);
  });

  it('种子固定时结果稳定，换种子则不同；总时长不变', () => {
    const a = computeRevealPlan({ ...base, chars: 24, dustSeed: 42 });
    expect(computeRevealPlan({ ...base, chars: 24, dustSeed: 42 }).dust).toEqual(a.dust);
    expect(computeRevealPlan({ ...base, chars: 24, dustSeed: 43 }).dust).not.toEqual(a.dust);
    expect(a.total).toBe(computeRevealPlan({ ...base, chars: 24 }).total);
  });
});

describe('answer/notice（11 §7）', () => {
  it('提示页：message 为空时回退到静态文案（危机分流）', () => {
    const d = describeNotice({ kind: 'notice', status: 'sensitive', message: '', resources: [] });
    expect(d.title).toBe(zh.notice.sensitive.title);
    expect(d.body).toBe(zh.notice.sensitive.fallback);
    expect(d.actions.map((a) => a.action)).toEqual(['newQuestion']);
    const u = describeNotice({ kind: 'notice', status: 'unclear', message: '说具体一点？' });
    expect(u.body).toBe('说具体一点？');
    expect(u.actions[0]?.action).toBe('reask');
  });

  it('可重试错误：补充句与倒计时', () => {
    const rl = describeNotice({
      kind: 'error',
      error: { code: 'RATE_LIMITED', message: '', retryable: true, retryAfterMs: 4200 },
    });
    expect(rl.variant).toBe('retryable');
    expect(rl.extra).toBe('春风有些应接不暇，5 秒后再试。');
    expect(rl.countdown).toBe(true);
    expect(rl.actions.map((a) => a.action)).toEqual(['retry', 'newQuestion']);
    const net = describeNotice({ kind: 'error', error: { code: 'NETWORK', message: '', retryable: true } });
    expect(net.extra).toBe(zh.error.network);
    expect(net.countdown).toBe(false);
  });

  it('SERVICE_MISCONFIGURED 不提供重试；离线；404', () => {
    const m = describeNotice({
      kind: 'error',
      error: { code: 'SERVICE_MISCONFIGURED', message: '', retryable: false },
    });
    expect(m.title).toBe(zh.error.misconfigured.title);
    expect(m.actions.some((a) => a.action === 'retry')).toBe(false);
    const off = describeNotice({ kind: 'error', error: { code: 'OFFLINE', message: '', retryable: true } });
    expect(off.title).toBe(zh.error.offline.title);
    expect(off.actions[0]?.action).toBe('retry');
    expect(describeNotice({ kind: 'notFound' }).title).toBe(zh.notFound.title);
  });
});
