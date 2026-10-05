'use client';

// 附图槽位（15 §10.1–§10.4）：题字线左端，与第一行文字垂直居中。
// 未附图：只有图标的附图按钮（触发隐藏的文件选择器）；已附图：缩略图（点击预览，失败时点击重试）+ 右上角 ✕ 删除。

import { type ChangeEvent, type Ref, useRef } from 'react';
import { Icon } from '@/components/ui/Icon';
import { zh } from '@/copy/zh';
import styles from './AttachSlot.module.css';
import type { AttachmentView } from './useImageAttachment';

export interface AttachSlotProps {
  attachment: AttachmentView;
  visible: boolean;
  disabled?: boolean;
  onPick(file: File): void;
  onRemove(): void;
  onRetry(): void;
  onPreview(): void;
  /** 选择后焦点回到铭牌 */
  onPicked?(): void;
  buttonRef?: Ref<HTMLButtonElement>;
  thumbRef?: Ref<HTMLButtonElement>;
}

export function AttachSlot({
  attachment,
  visible,
  disabled,
  onPick,
  onRemove,
  onRetry,
  onPreview,
  onPicked,
  buttonRef,
  thumbRef,
}: AttachSlotProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const { status, previewUrl } = attachment;

  const onFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.currentTarget.files?.[0];
    e.currentTarget.value = ''; // 允许再次选择同一个文件
    if (file) {
      onPick(file);
      onPicked?.();
    }
  };

  const failed = status === 'failed';
  const busy = status === 'uploading';

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: 只阻止按下时的默认聚焦，点击仍由内部按钮处理
    <div
      className={styles.slot}
      data-visible={visible || undefined}
      data-status={status}
      inert={!visible}
      // 按下时不抢走铭牌的焦点：否则输入框先失焦、打字机重启，槽位会在点中之前隐藏（15 §10.2）
      onMouseDown={(e) => e.preventDefault()}
    >
      {status === 'none' ? (
        <>
          <button
            ref={buttonRef}
            type="button"
            className={styles.attach}
            aria-label={zh.cover.image.attach}
            title={zh.cover.image.attach}
            disabled={disabled}
            onClick={() => fileRef.current?.click()}
            data-testid="attach-button"
          >
            <Icon name="image" size={22} />
          </button>
          <input
            ref={fileRef}
            className={styles.file}
            type="file"
            accept="image/*"
            tabIndex={-1}
            aria-hidden="true"
            onChange={onFile}
            data-testid="attach-input"
          />
        </>
      ) : (
        <span className={styles.thumbWrap}>
          <button
            ref={thumbRef}
            type="button"
            className={styles.thumb}
            aria-label={failed ? zh.cover.image.retry : zh.cover.image.preview}
            aria-busy={busy || undefined}
            disabled={disabled}
            onClick={() => (failed ? onRetry() : previewUrl ? onPreview() : undefined)}
            data-testid="attach-thumb"
          >
            {previewUrl ? (
              // biome-ignore lint/performance/noImgElement: 本地 blob URL 或 data URL
              <img className={styles.img} src={previewUrl} alt="" draggable={false} />
            ) : (
              <span className={styles.placeholder} aria-hidden="true">
                <Icon name="image" size={16} />
              </span>
            )}
            <span className={styles.veil} aria-hidden="true" />
            {failed ? <span className={styles.dot} aria-hidden="true" /> : null}
          </button>
          <button
            type="button"
            className={styles.remove}
            aria-label={zh.cover.image.remove}
            disabled={disabled}
            onClick={onRemove}
            data-testid="attach-remove"
          >
            <Icon name="close" size={14} />
          </button>
        </span>
      )}
    </div>
  );
}
