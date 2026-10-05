// 答案页的纯函数：显示文本、无障碍标签、提问字号档位、求助电话（11 §1、§4、§7）

import { fill, formatQuestionQuote, zh } from '@/copy/zh';
import { formatPct } from '@/lib/shared/percent';
import { splitGraphemes } from '@/lib/shared/question';
import type { ReadingOption } from '@/lib/shared/types';

/** 选项的百分比文本：pct = 0（而概率 > 0）显示「<1%」 */
export function optionPctText(option: Pick<ReadingOption, 'pct' | 'prob'>): string {
  return formatPct(option.pct, option.prob);
}

/** 屏幕阅读器读作「B，拿着邀约谈一次加薪，25%，已收起」（11 §4.1） */
export function optionAriaLabel(option: ReadingOption, expanded: boolean): string {
  return fill(zh.answer.optionLabel, {
    letter: option.letter,
    title: option.title,
    pct: optionPctText(option),
    state: expanded ? zh.answer.expanded : zh.answer.collapsed,
  });
}

/** 提问加上直角引号后拆成字素簇，供逐字显现 */
export function questionGlyphs(question: string): string[] {
  return splitGraphemes(formatQuestionQuote(question));
}

export type QuestionSize = 'short' | 'medium' | 'long';

/** 提问越长，字号越小一档，避免长提问把选项挤出版心（11 §2.3） */
export function questionSize(question: string): QuestionSize {
  const n = splitGraphemes(question).length;
  if (n <= 24) return 'short';
  if (n <= 60) return 'medium';
  return 'long';
}

/** 「110 / 120」这样的组合号码拆成多个 */
export function splitPhones(phone: string): string[] {
  return phone
    .split(/\s*[/／、,，]\s*/)
    .map((p) => p.trim())
    .filter(Boolean);
}

/** tel: 链接只保留数字与开头的 + */
export function telHref(phone: string): string {
  const digits = phone.replace(/[^\d+]/g, '');
  return `tel:${digits.startsWith('+') ? `+${digits.slice(1).replace(/\+/g, '')}` : digits.replace(/\+/g, '')}`;
}
