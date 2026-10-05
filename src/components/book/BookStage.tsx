// 书本舞台（07 §2、§3）：全视口根节点（perspective = geometry.perspective）+ 书（打开态右页为盒子）
// + 全屏翻页层（书壳之上、操作区之下）+ 光幕（翻页层之上，09 §5.1）。几何写成 CSS 变量；尚无几何时由 CSS 近似布局兜底。

import type { ReactNode, RefObject } from 'react';
import styles from './BookStage.module.css';
import type { Posture } from './useBookEffects';

export interface BookStageProps {
  posture: Posture;
  bookRef: RefObject<HTMLDivElement | null>;
  layerRef: RefObject<HTMLDivElement | null>;
  children: ReactNode;
  /** 翻页层之上的光幕（Lumen） */
  overlay?: ReactNode;
}

export function BookStage({ posture, bookRef, layerRef, children, overlay }: BookStageProps) {
  return (
    <div className={styles.stage} data-testid="book-stage">
      <div ref={bookRef} className={styles.book} data-posture={posture}>
        {children}
      </div>
      <div ref={layerRef} className={styles.flipLayer} data-testid="flip-layer" />
      {overlay}
    </div>
  );
}
