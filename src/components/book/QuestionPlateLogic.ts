// 输入铭牌的纯逻辑（08 §2）：长度上限、粘贴规范化、回车判定、占位符打字机、输入浮现、草稿存取。

import { graphemeLength, normalizeQuestion, QUESTION_MAX, splitGraphemes } from '@/lib/shared/question';

export const COUNTER_FROM = 160;
export const DRAFT_KEY = 'chunfeng:draft';
export const DRAFT_DEBOUNCE_MS = 300;

/** 轮换到下一个占位符 */
export function nextPlaceholderIndex(current: number, total: number): number {
  if (total <= 0) return 0;
  return (current + 1) % total;
}

// ---------- 占位符打字机：逐字打出 → 停留 → 逐字退格 → 换下一句 ----------

export const TYPE_MS = 110;
export const ERASE_MS = 45;
export const HOLD_MS = 2200;
export const GAP_MS = 500;

export interface TypewriterState {
  /** 当前句子序号 */
  index: number;
  /** 已显示的字数（按字素计） */
  shown: number;
  phase: 'typing' | 'holding' | 'erasing';
}

/** 走一步，返回下一状态与距离下一步的等待时长 */
export function stepTypewriter(
  s: TypewriterState,
  lengths: readonly number[],
): { state: TypewriterState; delay: number } {
  const total = lengths.length;
  if (total === 0) return { state: s, delay: HOLD_MS };
  const len = lengths[s.index] ?? 0;
  if (s.phase === 'typing') {
    if (s.shown + 1 >= len) return { state: { ...s, shown: len, phase: 'holding' }, delay: HOLD_MS };
    return { state: { ...s, shown: s.shown + 1 }, delay: TYPE_MS };
  }
  if (s.phase === 'holding') return { state: { ...s, phase: 'erasing' }, delay: ERASE_MS };
  if (s.shown > 1) return { state: { ...s, shown: s.shown - 1 }, delay: ERASE_MS };
  return {
    state: { index: nextPlaceholderIndex(s.index, total), shown: 0, phase: 'typing' },
    delay: GAP_MS,
  };
}

// ---------- 输入浮现：每个字带一份元数据（key 等），只有新写入的字拿到新的（从而播放浮现动画） ----------

/**
 * 按公共前缀、公共后缀对齐前后两版文本（按字素）：两端未变的字沿用原元数据，
 * 中间新插入或替换进来的字调用 make(offset) 生成，offset 为它在这段新字中的序号。
 */
export function diffGlyphs<T>(
  prev: readonly string[],
  prevMeta: readonly T[],
  next: readonly string[],
  make: (offset: number) => T,
): T[] {
  const max = Math.min(prev.length, next.length);
  let head = 0;
  while (head < max && prev[head] === next[head]) head++;
  let tail = 0;
  while (tail < max - head && prev[prev.length - 1 - tail] === next[next.length - 1 - tail]) tail++;
  const meta = prevMeta.slice(0, head);
  for (let i = head; i < next.length - tail; i++) meta.push(make(i - head));
  meta.push(...prevMeta.slice(prev.length - tail));
  return meta;
}

export function shouldShowCounter(length: number): boolean {
  return length >= COUNTER_FROM;
}

/** Enter 且不在输入法组合中（08 §2） */
export function isSubmitEnter(e: { key: string; isComposing?: boolean; keyCode?: number }): boolean {
  return e.key === 'Enter' && !e.isComposing && e.keyCode !== 229;
}

/** 键入后的值：换行改为空格（提问按单段处理），超出上限时截断 */
export function sanitizeTyped(value: string, max = QUESTION_MAX): { value: string; truncated: boolean } {
  const single = value.replace(/[\r\n\u2028\u2029]+/g, ' ');
  const parts = splitGraphemes(single);
  if (parts.length <= max) return { value: single, truncated: false };
  return { value: parts.slice(0, max).join(''), truncated: true };
}

/**
 * 粘贴：规范化粘贴内容的空白与不可见字符，插入到选区；
 * 超过上限时只保留放得下的部分，并返回 truncated = true。
 */
export function insertPaste(
  current: string,
  selStart: number,
  selEnd: number,
  pasted: string,
  max = QUESTION_MAX,
): { value: string; caret: number; truncated: boolean } {
  const before = current.slice(0, selStart);
  const after = current.slice(selEnd);
  const clean = normalizeQuestion(pasted);
  const room = Math.max(0, max - graphemeLength(before) - graphemeLength(after));
  const parts = splitGraphemes(clean);
  const inserted = parts.length > room ? parts.slice(0, room).join('') : clean;
  return {
    value: before + inserted + after,
    caret: before.length + inserted.length,
    truncated: parts.length > room,
  };
}

// ---------- 草稿（sessionStorage，失败时静默降级：07 §7） ----------

export function readDraft(): string {
  try {
    return globalThis.sessionStorage?.getItem(DRAFT_KEY) ?? '';
  } catch {
    return '';
  }
}

export function writeDraft(value: string): void {
  try {
    if (value) globalThis.sessionStorage?.setItem(DRAFT_KEY, value);
    else globalThis.sessionStorage?.removeItem(DRAFT_KEY);
  } catch {
    // 无痕模式等场景下可能抛错，忽略
  }
}

export function clearDraft(): void {
  writeDraft('');
}
