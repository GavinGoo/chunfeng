'use client';

// 选项与 U 型说明框（11 §4）

import { useId, useLayoutEffect, useRef } from 'react';
import { Icon } from '@/components/ui/Icon';
import { formatDescRegion } from '@/copy/zh';
import type { ReadingOption } from '@/lib/shared/types';
import { captureExpand, type ExpandSnapshot, playExpand } from './expandMotion';
import { optionAriaLabel, optionPctText } from './labels';
import styles from './OptionItem.module.css';

export interface OptionItemProps {
  option: ReadingOption;
  /** 第一名（A）：朱砂 */
  first: boolean;
  expanded: boolean;
  onToggle(letter: ReadingOption['letter']): void;
}

export function OptionItem({ option, first, expanded, onToggle }: OptionItemProps) {
  const uid = useId();
  const panelId = `desc-${option.letter}-${uid.replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const pctText = optionPctText(option);
  const itemRef = useRef<HTMLLIElement>(null);
  const pending = useRef<ExpandSnapshot | null>(null);

  // 展开 / 收起的布局提交后再播放位移（FLIP，11 §4.3）
  useLayoutEffect(() => {
    const snap = pending.current;
    const item = itemRef.current;
    pending.current = null;
    if (snap && item) playExpand(item, expanded, snap);
  }, [expanded]);

  return (
    <li
      ref={itemRef}
      className={styles.item}
      data-first={first || undefined}
      data-ink="item"
      data-ink-block=""
    >
      {/* 外框：上沿静止，下半截（两侧、下边框与下圆角）随说明一起滑动 */}
      <span className={styles.frameTop} aria-hidden="true" />
      <span className={styles.frameClip} aria-hidden="true">
        <span className={styles.frameBottom} data-frame-bottom="" />
      </span>
      <button
        type="button"
        className={styles.option}
        aria-expanded={expanded}
        aria-controls={panelId}
        aria-label={optionAriaLabel(option, expanded)}
        style={{ '--p': Math.min(1, Math.max(0, option.prob)) } as React.CSSProperties}
        onClick={() => {
          if (itemRef.current) pending.current = captureExpand(itemRef.current);
          onToggle(option.letter);
        }}
      >
        <span className={styles.fill} data-ink="fill" aria-hidden="true" />
        <span className={styles.seal} data-ink={first ? 'seal' : undefined} aria-hidden="true">
          {option.letter}
        </span>
        <span className={styles.title} aria-hidden="true">
          {option.title}
        </span>
        <span className={styles.pct} aria-hidden="true" data-pct-target={option.pct} data-pct-final={pctText}>
          {pctText}
        </span>
        <Icon name="chevron" size={16} className={styles.chevron} />
      </button>
      <section
        className={styles.panel}
        id={panelId}
        data-panel=""
        aria-label={formatDescRegion(option.letter)}
        aria-hidden={!expanded}
        inert={!expanded}
      >
        <div className={styles.panelClip} data-panel-clip="">
          <div className={styles.panelBody} data-panel-body="">
            {option.desc}
          </div>
        </div>
      </section>
    </li>
  );
}
