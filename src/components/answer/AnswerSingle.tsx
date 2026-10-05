'use client';

// 竖屏单页（11 §2.1）：页眉时间 / 提问 / 分割线 / 四个选项 / 首次引导；页脚在下方页边

import type { Reading } from '@/lib/shared/types';
import styles from './AnswerPage.module.css';
import { FirstHint, Folio, OptionList, Question, Rule, TimeHeader, useFirstHint } from './blocks';
import { Photo } from './Photo';
import { ScrollArea } from './ScrollArea';

export interface AnswerLayoutProps {
  reading: Reading;
  compact: boolean;
}

export function AnswerSingle({ reading, compact }: AnswerLayoutProps) {
  const hint = useFirstHint();
  return (
    <div className={styles.page}>
      <ScrollArea>
        <TimeHeader createdAt={reading.createdAt} tz={reading.tz} />
        {reading.image ? (
          // 带图提问：相片浮在提问右侧，与提问第一行顶部对齐（15 §11.1）
          <div className={styles.questionBlock}>
            <Photo readingId={reading.id} image={reading.image} mode="single" compact={compact} />
            <Question question={reading.question} compact={compact} />
          </div>
        ) : (
          <Question question={reading.question} compact={compact} />
        )}
        <Rule />
        <OptionList options={reading.options} onToggle={hint.dismiss} />
        <FirstHint state={hint.state} onGone={hint.gone} />
      </ScrollArea>
      <Folio reading={reading} show="both" />
    </div>
  );
}
