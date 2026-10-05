'use client';

// 答案页与提示页共用的内容块（11 §1）：页眉时间、提问、分割线、风纹饰、选项列表、首次引导、页脚

import { useEffect, useRef, useState } from 'react';
import { VisuallyHidden } from '@/components/ui/VisuallyHidden';
import { formatPageNo, zh } from '@/copy/zh';
import { hasSeenHint, markHintSeen } from '@/lib/client/storage';
import { formatGregorian, formatLunarWithShichen } from '@/lib/shared/datetime';
import type { Reading, ReadingOption } from '@/lib/shared/types';
import styles from './AnswerPage.module.css';
import { questionGlyphs, questionSize } from './labels';
import { OptionItem } from './OptionItem';

export function TimeHeader({ createdAt, tz }: { createdAt: string; tz: string }) {
  const date = new Date(createdAt);
  const lunar = formatLunarWithShichen(date, tz);
  return (
    <p className={styles.header} data-ink="head" data-ink-block="">
      <time dateTime={createdAt} className={styles.nowrap}>
        {formatGregorian(date, tz)}
      </time>
      {lunar ? (
        <>
          <span className={styles.lunar}>
            <span className={styles.sep}>{zh.answer.dateSeparator}</span>
            <span className={styles.nowrap}>{lunar}</span>
          </span>
        </>
      ) : null}
    </p>
  );
}

export interface QuestionProps {
  question: string;
  compact?: boolean;
  /** 横屏左页：大一级 */
  large?: boolean;
  /** 提示页：小一级 */
  quiet?: boolean;
}

/**
 * 提问标题：逐字的 span 设为 aria-hidden，另放一份完整文本供屏幕阅读器（11 §5）。
 * 低矮横屏限 3 行，超出时可点击展开全文（11 §2.3）。
 */
export function Question({ question, compact = false, large = false, quiet = false }: QuestionProps) {
  const glyphs = questionGlyphs(question);
  const textRef = useRef<HTMLElement | null>(null);
  const [clamped, setClamped] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const el = textRef.current;
    if (!compact || !el) {
      setClamped(false);
      return;
    }
    const measure = () => setClamped(el.scrollHeight > el.clientHeight + 1);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [compact]);

  const toggleable = compact && (clamped || open);
  const toggle = () => setOpen((v) => !v);
  const chars = glyphs.map((g, i) => (
    // biome-ignore lint/suspicious/noArrayIndexKey: 字素簇可重复，顺序固定
    <span key={i} data-ink="char" aria-hidden="true">
      {g}
    </span>
  ));

  return (
    <h2
      className={styles.question}
      data-size={questionSize(question)}
      data-large={large || undefined}
      data-quiet={quiet || undefined}
      data-ink-block=""
      data-focus-heading=""
      tabIndex={-1}
    >
      <VisuallyHidden>
        {zh.a11y.questionPrefix}
        {question}
      </VisuallyHidden>
      {compact ? (
        // 低矮横屏：限 3 行，被截断时整段文字就是「展开全文」的按钮；未被截断时按钮不可用，也不暴露给读屏
        <button
          ref={(el) => {
            textRef.current = el;
          }}
          type="button"
          className={styles.questionText}
          data-clamp={open ? undefined : ''}
          disabled={!toggleable}
          aria-hidden={toggleable ? undefined : true}
          aria-expanded={toggleable ? open : undefined}
          aria-label={open ? zh.answer.collapseQuestion : zh.answer.expandQuestion}
          onClick={toggle}
        >
          {chars}
        </button>
      ) : (
        <span
          ref={(el) => {
            textRef.current = el;
          }}
          className={styles.questionText}
          aria-hidden="true"
        >
          {chars}
        </span>
      )}
    </h2>
  );
}

/** 分割线：细线，中央一枚菱形小饰 */
export function Rule() {
  return (
    <div className={styles.rule} data-ink="rule" data-ink-block="" aria-hidden="true">
      <span className={styles.ruleLine} />
      <span className={styles.diamond} />
      <span className={styles.ruleLine} />
    </div>
  );
}

/** 横屏左页：一枚极淡的风纹饰 */
export function WindOrnament() {
  return (
    <div className={styles.ornament} data-ink="ornament" data-ink-block="" aria-hidden="true">
      <svg viewBox="0 0 200 64" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth={1}>
        <path
          d="M8 34c26-14 52 10 84-2s44-20 70-8c14 6 22 18 12 24-8 5-16-3-10-9 5-5 12-1 11 4"
          vectorEffect="non-scaling-stroke"
        />
        <path d="M34 48c22-8 44 6 70-1s34-10 50-4" vectorEffect="non-scaling-stroke" />
        <path
          d="M52 18c18-7 38 3 60-3 12-3 20-6 28-2 6 3 5 10-1 10-5 0-6-6-2-8"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </div>
  );
}

/** 首次引导的可见性：挂载后读取 localStorage（SSR 时不渲染，保证水合一致） */
export function useFirstHint() {
  const [state, setState] = useState<'none' | 'shown' | 'leaving'>('none');
  useEffect(() => {
    if (!hasSeenHint()) setState('shown');
  }, []);
  const dismiss = () => {
    if (state !== 'shown') return;
    markHintSeen();
    setState('leaving');
  };
  return { state, dismiss, gone: () => setState('none') };
}

export function FirstHint({ state, onGone }: { state: 'none' | 'shown' | 'leaving'; onGone(): void }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const visible = state !== 'none';

  // 若纸页早已显现（SSR 直达），挂载时补一次淡入
  useEffect(() => {
    const el = ref.current;
    if (!visible || !el) return;
    const root = el.closest<HTMLElement>('[data-ink-state]');
    if (root?.dataset.inkState === 'shown') {
      el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 400, easing: 'ease-out' });
    }
  }, [visible]);

  useEffect(() => {
    if (state !== 'leaving') return;
    const t = setTimeout(onGone, 240);
    return () => clearTimeout(t);
  }, [state, onGone]);

  if (!visible) return null;
  return (
    <p
      ref={ref}
      className={styles.hint}
      data-leaving={state === 'leaving' || undefined}
      data-ink="hint"
      data-ink-block=""
    >
      {zh.answer.firstHint}
    </p>
  );
}

export function OptionList({ options, onToggle }: { options: ReadingOption[]; onToggle(): void }) {
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  const toggle = (letter: string) => {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(letter)) next.delete(letter);
      else next.add(letter);
      return next;
    });
    onToggle();
  };
  return (
    <ol className={styles.options} aria-label={zh.a11y.optionsLabel}>
      {options.map((o, i) => (
        <OptionItem
          key={o.letter}
          option={o}
          first={i === 0}
          expanded={open.has(o.letter)}
          onToggle={toggle}
        />
      ))}
    </ol>
  );
}

/** 页脚：AI 标识（合规）与装饰页码（旧式数字） */
export function Folio({
  reading,
  show,
}: {
  reading?: Pick<Reading, 'pageNo'>;
  show: 'both' | 'label' | 'pageNo';
}) {
  return (
    <footer className={styles.folio} data-ink="head" data-ink-block="">
      {show !== 'pageNo' ? <span className={styles.aiLabel}>{zh.answer.aiLabel}</span> : <span />}
      {show !== 'label' && reading ? (
        <span className={styles.pageNo}>{formatPageNo(reading.pageNo)}</span>
      ) : null}
    </footer>
  );
}
