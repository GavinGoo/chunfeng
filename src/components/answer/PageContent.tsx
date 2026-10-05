'use client';

// 纸页上的内容（11）：答案 / 提示 / 错误 / 404。只渲染内容（透明底），纸张、页块与书脊阴影由舞台绘制。
// 根节点是尺寸容器（container-type: size）；每一页也是容器，页内尺寸用 cqw 随页宽缩放。

import { forwardRef, useCallback, useImperativeHandle, useRef, useState } from 'react';
import type { ClientError } from '@/lib/client/createReading';
import type { HelpResource, Reading } from '@/lib/shared/types';
import styles from './AnswerPage.module.css';
import { AnswerSingle } from './AnswerSingle';
import { AnswerSpread } from './AnswerSpread';
import { NoticePage } from './NoticePage';
import type { PageAction } from './notice';
import { type InkState, useReveal } from './useReveal';

export type PageContentModel =
  | { kind: 'answer'; reading: Reading; owner: boolean }
  | {
      kind: 'notice';
      status: 'unclear' | 'sensitive' | 'refused';
      message: string;
      resources?: HelpResource[];
      question: string;
      /** 带图提问（15 §11.5）：提示页与错误页没有落库的答案，只在提问下方写「附图一张」 */
      hasImage?: boolean;
    }
  | { kind: 'error'; error: ClientError; question: string; hasImage?: boolean }
  | { kind: 'notFound' };

export interface PageContentHandle {
  /** 墨迹显现（11 §5）；显现完毕（或被跳过）时 resolve */
  reveal(): Promise<void>;
  /** 跳到最终状态 */
  skip(): void;
  /** 反向淡去约 500 ms（再翻一次） */
  dissolve(): Promise<void>;
  /** 07 §8：焦点移到提问标题（tabIndex -1） */
  focusHeading(): void;
}

export type { PageAction };

export interface PageContentProps {
  model: PageContentModel;
  mode: 'single' | 'spread';
  /** SSR / 直达 /a/:id：直接渲染最终状态，不做动画 */
  initiallyRevealed?: boolean;
  /** 低矮横屏（高度 < 480）：11 §2.3 */
  compact?: boolean;
  /** 纸页上的按钮（提示页、错误页，11 §7） */
  onAction?(a: PageAction): void;
  /** epoch ms：此前「再试一次」置灰并显示倒计时 */
  retryAvailableAt?: number;
  /** 离线页：恢复网络后高亮「再试一次」 */
  online?: boolean;
  /** 新增（可选）：ActionBar 应当淡入的时刻（11 §5 最后一行；跳过时立即触发） */
  onActionsCue?(): void;
  /** 新增（可选）：附加到根节点的类名 */
  className?: string;
}

export const PageContent = forwardRef<PageContentHandle, PageContentProps>(function PageContent(
  {
    model,
    mode,
    initiallyRevealed = false,
    compact = false,
    onAction,
    retryAvailableAt,
    online,
    onActionsCue,
    className,
  },
  ref,
) {
  const rootRef = useRef<HTMLDivElement>(null);
  // 初始状态只在首次渲染时确定；之后由 useReveal 直接写 DOM，React 不再改动该属性
  const [initialInk] = useState<InkState>(() => (initiallyRevealed ? 'shown' : 'hidden'));
  const { reveal, skip, dissolve } = useReveal(rootRef, { mode, onActionsCue });

  const focusHeading = useCallback(() => {
    const root = rootRef.current;
    const target =
      root?.querySelector<HTMLElement>('[data-focus-heading]') ?? root?.querySelector<HTMLElement>('h3');
    target?.focus({ preventScroll: false });
  }, []);

  useImperativeHandle(ref, () => ({ reveal, skip, dissolve, focusHeading }), [
    reveal,
    skip,
    dissolve,
    focusHeading,
  ]);

  return (
    <div
      ref={rootRef}
      className={[styles.root, className ?? ''].join(' ')}
      data-mode={mode}
      data-compact={compact || undefined}
      data-ink-state={initialInk}
      data-surface="paper"
    >
      {model.kind === 'answer' ? (
        mode === 'spread' ? (
          <AnswerSpread reading={model.reading} compact={compact} />
        ) : (
          <AnswerSingle reading={model.reading} compact={compact} />
        )
      ) : (
        <NoticePage
          model={model}
          mode={mode}
          compact={compact}
          onAction={onAction}
          retryAvailableAt={retryAvailableAt}
          online={online}
        />
      )}
      {/* 金尘层（11 §5.1）：只在答案页；节点由 useReveal 生成与移除 */}
      {model.kind === 'answer' ? <div className={styles.dust} data-dust aria-hidden="true" /> : null}
    </div>
  );
});
