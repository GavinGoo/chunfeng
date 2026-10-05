'use client';

// 查看大图（15 §11.4）：全屏弹层，先显示 thumb，full 加载完成后替换。
// 关闭：右上角「关闭」、Esc、点击遮罩；焦点困在弹层内，关闭后回到触发元素（与分享弹层共用 useModalFocus）。
// 图片是真实的 URL（封面预览时是 blob URL），手机上可以长按保存。

import { type RefObject, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { zh } from '@/copy/zh';
import { Icon } from './Icon';
import styles from './ImageViewer.module.css';
import { useModalFocus } from './useModalFocus';

export interface ImageViewerProps {
  open: boolean;
  /** 先显示的图（答案页为 thumb，封面为 blob URL） */
  src: string;
  /** 加载完成后替换为这张（答案页为 full） */
  fullSrc?: string;
  alt: string;
  width?: number;
  height?: number;
  onClose(): void;
  returnFocusTo?: RefObject<HTMLElement | null>;
}

const EXIT_MS = 320;

export function ImageViewer({
  open,
  src,
  fullSrc,
  alt,
  width,
  height,
  onClose,
  returnFocusTo,
}: ImageViewerProps) {
  const [rendered, setRendered] = useState(open);
  const [visible, setVisible] = useState(false);
  const [shown, setShown] = useState(src);
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const onKeyDown = useModalFocus({ open, panelRef, initialFocusRef: closeRef, returnFocusTo, onClose });

  useEffect(() => {
    if (open) {
      setRendered(true);
      setShown(src);
      const raf = requestAnimationFrame(() => requestAnimationFrame(() => setVisible(true)));
      return () => cancelAnimationFrame(raf);
    }
    setVisible(false);
    const t = setTimeout(() => setRendered(false), EXIT_MS);
    return () => clearTimeout(t);
  }, [open, src]);

  // 预加载 full，完成后替换
  useEffect(() => {
    if (!open || !fullSrc || fullSrc === src) return;
    const img = new Image();
    let cancelled = false;
    img.onload = () => {
      if (!cancelled) setShown(fullSrc);
    };
    img.src = fullSrc;
    return () => {
      cancelled = true;
    };
  }, [open, fullSrc, src]);

  if (!rendered || typeof document === 'undefined') return null;

  return createPortal(
    <div className={styles.root} data-visible={visible || undefined} data-testid="image-viewer">
      <div className={styles.overlay} aria-hidden="true" onClick={onClose} />
      <div
        ref={panelRef}
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-label={zh.viewer.label}
        onKeyDown={onKeyDown}
      >
        {/* biome-ignore lint/performance/noImgElement: 两种规格已由服务端生成；须是真实 URL 才能长按保存 */}
        <img className={styles.image} src={shown} alt={alt} width={width} height={height} decoding="async" />
        <button
          ref={closeRef}
          type="button"
          className={styles.close}
          aria-label={zh.viewer.close}
          onClick={onClose}
        >
          <Icon name="close" size={20} />
        </button>
      </div>
    </div>,
    document.body,
  );
}

export default ImageViewer;
