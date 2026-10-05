// 空白纸页（07 §2、06 §4）：与翻页引擎同一张 paper.webp（background-size: 100% 100%），
// 靠书脊一侧有书脊阴影。收尾时画布淡出，露出的正是这张纸，视觉上无缝（09 §5）。

import styles from './BookShell.module.css';

export interface PageBaseProps {
  side: 'left' | 'right';
  /** 不可见时透明度为 0：出现时立即不透明，隐藏时 200 ms 淡出 */
  visible?: boolean;
}

export function PageBase({ side, visible = true }: PageBaseProps) {
  return (
    <div
      className={styles.page}
      data-side={side}
      data-visible={visible || undefined}
      data-testid={`page-base-${side}`}
      aria-hidden="true"
    />
  );
}
