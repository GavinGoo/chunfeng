'use client';

// 输入铭牌（08 §2）：封面正中的压凹皮革面 + 细金边，内有一行居中的 textarea。
//
// 受控组件：
//   <QuestionPlate value onChange onEnter readOnly flashKey onTruncate counterId inputRef />
// - onEnter：按下 Enter（不在输入法组合中）时调用，由 Cover 判断是否可以提交；
// - flashKey：每次递增时，边框亮起一次（600 ms），用于「点击禁用态」的引导；
// - onTruncate：粘贴或键入超过 200 字被截断时调用，由 Cover 显示「已截取前 200 字」。
// 草稿：值变化 300 ms 后写入 sessionStorage；挂载时若值为空则恢复草稿。
//
// 占位符：为空且用户未点进输入框时，以打字机效果逐句打出、退格、换下一句；
// 用户点击或开始输入即隐藏，失焦后若仍为空则恢复轮播（桌面端的自动聚焦不算「点进」）；页面隐藏时停下。
// 输入浮现：textarea 自身文字透明（只留光标与选区），其下垫一层逐字排版完全一致的镜像；
// 新写入的字在镜像里由晕开的墨光中凝成金字。输入法组合中的字以虚线下划线标出，定字后再浮现。

import {
  type ClipboardEvent,
  type FocusEvent,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
  type Ref,
  type SyntheticEvent,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { formatCounter, formatCounterLabel, zh } from '@/copy/zh';
import { graphemeLength, QUESTION_MAX, splitGraphemes } from '@/lib/shared/question';
import styles from './QuestionPlate.module.css';
import {
  DRAFT_DEBOUNCE_MS,
  diffGlyphs,
  insertPaste,
  isSubmitEnter,
  nextPlaceholderIndex,
  readDraft,
  sanitizeTyped,
  shouldShowCounter,
  stepTypewriter,
  type TypewriterState,
  writeDraft,
} from './QuestionPlateLogic';

function subscribeVisibility(onChange: () => void): () => void {
  document.addEventListener('visibilitychange', onChange);
  return () => document.removeEventListener('visibilitychange', onChange);
}

/** 页面是否可见（服务端渲染时按可见处理） */
function usePageVisible(): boolean {
  return useSyncExternalStore(
    subscribeVisibility,
    () => document.visibilityState === 'visible',
    () => true,
  );
}

export interface QuestionPlateProps {
  value: string;
  onChange(value: string): void;
  onEnter(): void;
  readOnly?: boolean;
  flashKey?: number;
  onTruncate?(): void;
  /** 桌面端（精确指针）挂载时自动聚焦；移动端不自动弹出键盘 */
  autoFocusDesktop?: boolean;
  /** 额外的描述（如铭牌下方的提示）id，与计数一起挂到 aria-describedby */
  describedBy?: string;
  inputRef?: Ref<HTMLTextAreaElement>;
  /**
   * 图片提问（15 §10）：开启时 textarea 与镜像层始终左右各留 40 px（紧凑 34 px），附图槽位出现、消失都不重排；
   * slot 渲染在题字线左端，DOM 顺序在输入框之前（焦点顺序：附图 → 铭牌）
   */
  vision?: boolean;
  slot?: ReactNode;
  /**
   * 「点进」状态变化：指针点入（click）、按键（含开始输入法组合）、用 Tab 键聚焦时为 true（桌面端的自动聚焦不算）；
   * 焦点离开铭牌（含附图槽位）时为 false，占位符打字机随之重新开始
   */
  onEngagedChange?(engaged: boolean): void;
  /** 粘贴时剪贴板里有图片文件；同时有文字的，文字照常粘贴 */
  onPasteFiles?(files: File[]): void;
  /** 题字线亮起（同聚焦态），如拖着图片经过封面时 */
  lit?: boolean;
}

const PLACEHOLDERS = zh.cover.input.placeholders.map(splitGraphemes);
const PLACEHOLDER_LENGTHS = PLACEHOLDERS.map((p) => p.length);
const DESKTOP_QUERY = '(hover: hover) and (pointer: fine)';
const REDUCED_QUERY = '(prefers-reduced-motion: reduce)';
/** 首次打字等封面进场结束 */
const TYPE_START_MS = 1000;
/** 一次写入多个字（粘贴、预填、定字）时逐字错开浮现 */
const INK_STAGGER_MS = 28;
const INK_STAGGER_MAX = 20;

interface Glyph {
  key: number;
  delay: number;
}

interface Ink {
  value: string;
  chars: string[];
  glyphs: Glyph[];
  next: number;
}

function inkFor(value: string, prev?: Ink): Ink {
  const chars = splitGraphemes(value);
  let next = prev?.next ?? 0;
  const make = (offset: number): Glyph => ({
    key: next++,
    delay: Math.min(offset, INK_STAGGER_MAX) * INK_STAGGER_MS,
  });
  // 首次渲染（含服务端）已有的字不播放动画
  const glyphs = prev ? diffGlyphs(prev.chars, prev.glyphs, chars, make) : chars.map(() => make(0));
  return { value, chars, glyphs, next };
}

function assignRef<T>(ref: Ref<T> | undefined, value: T | null) {
  if (typeof ref === 'function') ref(value);
  else if (ref) ref.current = value;
}

export function QuestionPlate({
  value,
  onChange,
  onEnter,
  readOnly = false,
  flashKey = 0,
  onTruncate,
  autoFocusDesktop = true,
  describedBy,
  inputRef,
  vision = false,
  slot,
  onEngagedChange,
  onPasteFiles,
  lit = false,
}: QuestionPlateProps) {
  const areaRef = useRef<HTMLTextAreaElement | null>(null);
  const composing = useRef(false);
  const pendingCaret = useRef<number | null>(null);
  const mirrorRef = useRef<HTMLDivElement | null>(null);
  const composeFrom = useRef<{ start: number; outside: number } | null>(null);
  /** 用户是否已点进（或在其中按键）；失焦时复位 */
  const [engaged, setEngaged] = useState(false);
  const [typer, setTyper] = useState<TypewriterState>({ index: 0, shown: 0, phase: 'typing' });
  const [flashing, setFlashing] = useState(false);
  /** 输入法组合中的文字范围（UTF-16 下标） */
  const [composeRange, setComposeRange] = useState<[number, number] | null>(null);
  const counterId = useId();

  const length = graphemeLength(value);
  const showCounter = shouldShowCounter(length);
  const empty = value.length === 0;
  const carousel = empty && !engaged && !readOnly;
  // 页面隐藏时打字机停下（16 §3.4），回到前台从下一句重新打起
  const pageVisible = usePageVisible();
  const typing = carousel && pageVisible;

  // 镜像的逐字元数据：值变化时在渲染中对齐前后两版（React 推荐的「随 props 调整 state」写法）
  const [ink, setInk] = useState(() => inkFor(value));
  let current = ink;
  if (ink.value !== value) {
    current = inkFor(value, ink);
    setInk(current);
  }

  // 恢复草稿（只在挂载时，且当前值为空）
  // biome-ignore lint/correctness/useExhaustiveDependencies: 只在挂载时执行一次
  useEffect(() => {
    if (value) return;
    const draft = readDraft();
    if (draft) onChange(sanitizeTyped(draft).value);
  }, []);

  // 草稿防抖写入；页面离开时立即写入最新值，避免防抖期间刷新丢字
  const latest = useRef(value);
  useEffect(() => {
    latest.current = value;
    const t = setTimeout(() => writeDraft(value), DRAFT_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [value]);
  useEffect(() => {
    const flush = () => writeDraft(latest.current);
    window.addEventListener('pagehide', flush);
    return () => window.removeEventListener('pagehide', flush);
  }, []);

  // 桌面端自动聚焦
  useEffect(() => {
    if (!autoFocusDesktop || readOnly) return;
    if (window.matchMedia(DESKTOP_QUERY).matches) {
      const el = areaRef.current;
      if (!el) return;
      el.focus({ preventScroll: true });
      const end = el.value.length;
      el.setSelectionRange(end, end);
    }
  }, [autoFocusDesktop, readOnly]);

  // 占位符打字机：轮播期间逐字打出 → 停留 → 退格 → 下一句；中断后从下一句重新打起
  const typerRef = useRef(typer);
  const started = useRef(false);
  useEffect(() => {
    if (!typing) return;
    const show = (next: TypewriterState) => {
      typerRef.current = next;
      setTyper(next);
    };
    const last = typerRef.current;
    if (window.matchMedia(REDUCED_QUERY).matches) {
      // 减少动态效果：不打字，整句静止显示
      show({ ...last, shown: PLACEHOLDER_LENGTHS[last.index] ?? 0, phase: 'holding' });
      return;
    }
    let state: TypewriterState = started.current
      ? { index: nextPlaceholderIndex(last.index, PLACEHOLDERS.length), shown: 0, phase: 'typing' }
      : last;
    show(state);
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      started.current = true;
      const step = stepTypewriter(state, PLACEHOLDER_LENGTHS);
      state = step.state;
      show(state);
      timer = setTimeout(tick, step.delay);
    };
    timer = setTimeout(tick, started.current ? 0 : TYPE_START_MS);
    return () => clearTimeout(timer);
  }, [typing]);

  // 边框亮起一次
  useEffect(() => {
    if (flashKey === 0) return;
    setFlashing(false);
    const raf = requestAnimationFrame(() => setFlashing(true));
    const t = setTimeout(() => setFlashing(false), 650);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(t);
    };
  }, [flashKey]);

  // 粘贴后把光标放到插入内容之后
  useLayoutEffect(() => {
    const caret = pendingCaret.current;
    const el = areaRef.current;
    if (caret === null || !el) return;
    pendingCaret.current = null;
    el.setSelectionRange(caret, caret);
  });

  // 镜像与 textarea 同步滚动（超过 4 行后内部滚动）
  // biome-ignore lint/correctness/useExhaustiveDependencies: value 变化时 textarea 可能自动滚到光标处
  useLayoutEffect(() => {
    const el = areaRef.current;
    if (el && mirrorRef.current) mirrorRef.current.scrollTop = el.scrollTop;
  }, [value]);

  // 不支持 field-sizing: content 的浏览器：用 JS 自动增高（1–4 行，超出后内部滚动）
  // biome-ignore lint/correctness/useExhaustiveDependencies: value 变化时重新测量
  useLayoutEffect(() => {
    const el = areaRef.current;
    if (!el || CSS.supports('field-sizing', 'content')) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  const handleInput = (e: FormEvent<HTMLTextAreaElement>) => {
    const raw = e.currentTarget.value;
    // 输入法组合中不截断，避免打断候选词；组合结束后再处理
    if (composing.current) {
      const from = composeFrom.current;
      if (from) setComposeRange([from.start, from.start + raw.length - from.outside]);
      onChange(raw.replace(/[\r\n]+/g, ' '));
      return;
    }
    const { value: next, truncated } = sanitizeTyped(raw);
    if (truncated) onTruncate?.();
    onChange(next);
  };

  const setEngagedState = (next: boolean) => {
    setEngaged(next);
    onEngagedChange?.(next);
  };

  const engage = () => {
    if (readOnly) return;
    setEngagedState(true);
  };

  // 焦点移到铭牌内的附图槽位，或整个窗口失焦（打开系统文件选择器、切换标签页）时仍算点进
  const handleBlur = (e: FocusEvent<HTMLDivElement>) => {
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    if (!document.hasFocus()) return;
    if (engaged) setEngagedState(false);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    engage();
    if (e.key !== 'Enter') return;
    // 任何情况下都不换行；只有不在输入法组合中时才提交
    if (isSubmitEnter({ key: e.key, isComposing: e.nativeEvent.isComposing, keyCode: e.keyCode })) {
      e.preventDefault();
      onEnter();
    } else if (!composing.current && !e.nativeEvent.isComposing) {
      e.preventDefault();
    }
  };

  const handlePaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const text = e.clipboardData.getData('text/plain');
    if (onPasteFiles && !readOnly) {
      const files = [...e.clipboardData.files].filter((f) => f.type.startsWith('image/'));
      if (files.length > 0) {
        onPasteFiles(files);
        if (!text) {
          e.preventDefault();
          return;
        }
      }
    }
    if (!text) return;
    e.preventDefault();
    const el = e.currentTarget;
    const result = insertPaste(value, el.selectionStart, el.selectionEnd, text, QUESTION_MAX);
    pendingCaret.current = result.caret;
    if (result.truncated) onTruncate?.();
    onChange(result.value);
  };

  const syncScroll = (e: SyntheticEvent<HTMLTextAreaElement>) => {
    if (mirrorRef.current) mirrorRef.current.scrollTop = e.currentTarget.scrollTop;
  };

  // 每个字在原文中的 UTF-16 起点，用来判断它是否落在输入法组合范围内
  let offset = 0;
  const mirror = current.chars.map((ch, i) => {
    const at = offset;
    offset += ch.length;
    const glyph = current.glyphs[i] as Glyph;
    const composingHere = composeRange !== null && at >= composeRange[0] && at < composeRange[1];
    return (
      <span
        key={glyph.key}
        className={styles.glyph}
        style={glyph.delay ? { animationDelay: `${glyph.delay}ms` } : undefined}
        data-composing={composingHere || undefined}
      >
        {ch}
      </span>
    );
  });

  const phrase = PLACEHOLDERS[typer.index] ?? [];

  const describedByIds =
    [showCounter ? counterId : '', describedBy ?? ''].filter(Boolean).join(' ') || undefined;

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: 只监听冒泡上来的聚焦与失焦，判断焦点是否在铭牌内
    <div
      className={styles.plate}
      data-flash={flashing || undefined}
      data-counter={showCounter || undefined}
      data-vision={vision || undefined}
      data-lit={lit || undefined}
      onFocus={(e) => {
        // 焦点落在附图槽位（Tab、删除图片后、关闭预览后回到缩略图）也算点进
        if (e.target !== (areaRef.current as EventTarget | null)) engage();
      }}
      onBlur={handleBlur}
    >
      <span className={styles.flash} aria-hidden="true" />
      {slot}
      <div className={styles.field}>
        {/* 自绘占位符：打字机逐字显现；未显现的字先占位，整句居中不随打字跳动。对读屏软件隐藏（输入框已有 aria-label） */}
        <span className={styles.placeholders} aria-hidden="true" data-hidden={!carousel || undefined}>
          <span key={typer.index} className={styles.placeholder}>
            {phrase.map((ch, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: 句内字序固定
              <span key={i} className={styles.ghost} data-on={i < typer.shown || undefined}>
                {ch}
              </span>
            ))}
          </span>
        </span>
        <div ref={mirrorRef} className={styles.mirror} aria-hidden="true">
          {mirror}
        </div>
        <textarea
          ref={(el) => {
            areaRef.current = el;
            assignRef(inputRef, el);
          }}
          className={styles.input}
          rows={1}
          value={value}
          readOnly={readOnly}
          aria-label={zh.cover.input.label}
          aria-describedby={describedByIds}
          enterKeyHint="send"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          onScroll={syncScroll}
          // 在 click（一次点按的最后一个事件）时才点进：若在 pointerdown 时就让附图按钮出现、占位符淡去，
          // 移动端随后补发的 mousedown / click 会落到新出现的按钮上，iOS 还会把这次点按当作「悬停」而不聚焦
          onClick={engage}
          onKeyUp={(e) => {
            // Tab 键聚焦进来时，keyup 落在输入框上
            if (e.key === 'Tab') engage();
          }}
          onCompositionStart={(e) => {
            composing.current = true;
            const el = e.currentTarget;
            composeFrom.current = {
              start: el.selectionStart,
              outside: el.value.length - (el.selectionEnd - el.selectionStart),
            };
            engage();
          }}
          onCompositionEnd={(e) => {
            composing.current = false;
            composeFrom.current = null;
            setComposeRange(null);
            const { value: next, truncated } = sanitizeTyped(e.currentTarget.value);
            if (truncated) onTruncate?.();
            if (next !== value) onChange(next);
          }}
        />
      </div>
      {showCounter ? (
        <span className={`${styles.counter} tnum`} aria-hidden="true">
          {formatCounter(length, QUESTION_MAX)}
        </span>
      ) : null}
      {showCounter ? (
        <span id={counterId} hidden>
          {formatCounterLabel(length, QUESTION_MAX)}
        </span>
      ) : null}
    </div>
  );
}
