'use client';

// 横屏双页（11 §2.2）：左页为页眉时间、提问与风纹饰；右页为「风吟」、四个选项与首次引导

import { zh } from '@/copy/zh';
import styles from './AnswerPage.module.css';
import type { AnswerLayoutProps } from './AnswerSingle';
import { FirstHint, Folio, OptionList, Question, TimeHeader, useFirstHint, WindOrnament } from './blocks';
import { Photo } from './Photo';
import { ScrollArea } from './ScrollArea';

export function AnswerSpread({ reading, compact }: AnswerLayoutProps) {
  const hint = useFirstHint();
  return (
    <>
      <div className={styles.page} data-side="left">
        <ScrollArea className={styles.leftScroll}>
          <TimeHeader createdAt={reading.createdAt} tz={reading.tz} />
          <div className={styles.leftBody}>
            <Question question={reading.question} compact={compact} large />
            {/* 带图提问：相片在提问下方居中，取代风纹饰（15 §11.1） */}
            {reading.image ? (
              <Photo readingId={reading.id} image={reading.image} mode="spread" compact={compact} />
            ) : (
              <WindOrnament />
            )}
          </div>
        </ScrollArea>
        <Folio show="label" />
      </div>
      <div className={styles.page} data-side="right">
        <ScrollArea>
          <p className={styles.answerHeading} data-ink="item" data-ink-block="">
            {zh.answer.heading}
          </p>
          <OptionList options={reading.options} onToggle={hint.dismiss} />
          <FirstHint state={hint.state} onGone={hint.gone} />
        </ScrollArea>
        <Folio reading={reading} show="pageNo" />
      </div>
    </>
  );
}
