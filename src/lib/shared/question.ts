// 提问规范化与字素簇计数（04 §2.1、08 §2）

export const QUESTION_MIN = 2;
export const QUESTION_MAX = 200;

// 零宽字符与控制字符（保留普通空白，稍后统一合并）
// biome-ignore lint/suspicious/noControlCharactersInRegex: 有意匹配并去除控制字符
const INVISIBLE = /[\u200B-\u200D\u2060\uFEFF\u00AD]|[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;

export function normalizeQuestion(input: string): string {
  return input.replace(INVISIBLE, '').replace(/\s+/g, ' ').trim();
}

let segmenter: Intl.Segmenter | undefined;
function getSegmenter(): Intl.Segmenter | undefined {
  if (segmenter) return segmenter;
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    segmenter = new Intl.Segmenter('zh', { granularity: 'grapheme' });
  }
  return segmenter;
}

export function splitGraphemes(text: string): string[] {
  const seg = getSegmenter();
  if (!seg) return Array.from(text);
  return Array.from(seg.segment(text), (s) => s.segment);
}

export function graphemeLength(text: string): number {
  return splitGraphemes(text).length;
}

export function truncateGraphemes(text: string, max: number): string {
  const parts = splitGraphemes(text);
  return parts.length <= max ? text : parts.slice(0, max).join('');
}

export function isQuestionLengthValid(normalized: string): boolean {
  const n = graphemeLength(normalized);
  return n >= QUESTION_MIN && n <= QUESTION_MAX;
}
