'use client';

// 选项与 U 型说明框（11 §4）

import { useId } from 'react';
import { Icon } from '@/components/ui/Icon';
import { formatDescRegion } from '@/copy/zh';
import type { ReadingOption } from '@/lib/shared/types';
import { optionAriaLabel, optionPctText } from './labels';
import styles from './OptionItem.module.css';
import { revealInScroll } from './ScrollArea';

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

  return (
    <li className={styles.item} data-first={first || undefined} data-ink="item" data-ink-block="">
      <button
        type="button"
        className={styles.option}
        aria-expanded={expanded}
        aria-controls={panelId}
        aria-label={optionAriaLabel(option, expanded)}
        style={{ '--p': Math.min(1, Math.max(0, option.prob)) } as React.CSSProperties}
        onClick={(e) => {
          onToggle(option.letter);
          if (!expanded) {
            const panel = e.currentTarget.nextElementSibling;
            // 等 grid-template-rows 的展开过渡结束后，确保说明框在版心内可见
            if (panel instanceof HTMLElement) setTimeout(() => revealInScroll(panel), 340);
          }
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
        aria-label={formatDescRegion(option.letter)}
        aria-hidden={!expanded}
        inert={!expanded}
      >
        <div className={styles.panelClip}>
          <div className={styles.panelBody}>{option.desc}</div>
        </div>
      </section>
    </li>
  );
}
