// 书壳（07 §2、06 §4）：书的投影、页块边缘与硬壳。
// 坐标系为「打开态右页」（书脊在左缘）；双页时左侧页块在 x = −100% 处，打开后淡入。

import styles from './BookShell.module.css';

export interface BookShellProps {
  mode: 'single' | 'spread' | null;
  /** 左侧页块（双页打开时） */
  showLeft: boolean;
}

export function BookShell({ mode, showLeft }: BookShellProps) {
  return (
    <>
      {mode !== 'single' ? (
        <div
          className={`${styles.block} ${styles.leftBlock}`}
          data-visible={showLeft || undefined}
          data-mode={mode ?? 'auto'}
          aria-hidden="true"
        >
          <span className={styles.edgeLeft} />
          <span className={styles.edgeBottom} />
        </div>
      ) : null}
      <div className={`${styles.block} ${styles.rightBlock}`} aria-hidden="true">
        <span className={styles.edgeRight} />
        <span className={styles.edgeBottom} />
      </div>
    </>
  );
}
