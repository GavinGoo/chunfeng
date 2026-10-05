'use client';

// 答案页的照片（15 §11）：冲印的小照片，对角插在两枚老相册相角里；整张照片是一个按钮，点击放大查看。
// 倾斜由 reading id 算出（SSR 即有）；显现：纱层淡去（显影）→ 相角淡入（插上）。

import dynamic from 'next/dynamic';
import { type CSSProperties, useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/ui/Icon';
import { formatPhotoLabel, zh } from '@/copy/zh';
import type { ReadingImage } from '@/lib/shared/types';
import styles from './Photo.module.css';
import { type PhotoMode, photoTilt, singlePhotoBox } from './photoStyle';

const ImageViewer = dynamic(() => import('@/components/ui/ImageViewer'), { ssr: false });

export interface PhotoProps {
  readingId: string;
  image: ReadingImage;
  mode: PhotoMode;
  compact?: boolean;
}

export function imageUrl(readingId: string, size: 'thumb' | 'full'): string {
  return `/api/readings/${readingId}/image?size=${size}`;
}

export function Photo({ readingId, image, mode, compact = false }: PhotoProps) {
  const tilt = photoTilt(readingId, mode);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);
  const [viewerMounted, setViewerMounted] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  // SSR 的 <img> 可能在水合前就已加载失败
  useEffect(() => {
    const img = imgRef.current;
    if (img?.complete && img.naturalWidth === 0) setFailed(true);
  }, []);

  const box = mode === 'single' ? singlePhotoBox(image, compact) : null;
  const style = {
    '--tilt': `${tilt}deg`,
    ...(box ? { '--photo-w': `${box.width}px`, '--photo-h': `${box.height}px` } : {}),
  } as CSSProperties;
  const alt = image.alt.trim() || zh.answer.photoAltFallback;

  return (
    <div className={styles.slot} data-mode={mode} data-ink-block="" data-photo-block="">
      <button
        ref={btnRef}
        type="button"
        className={styles.photo}
        style={style}
        data-ink="photo"
        data-failed={failed || undefined}
        aria-label={formatPhotoLabel(image.alt)}
        disabled={failed}
        onClick={() => {
          setViewerMounted(true);
          setOpen(true);
        }}
        data-testid="answer-photo"
      >
        <span className={styles.print}>
          {failed ? (
            <span
              className={styles.placeholder}
              style={mode === 'spread' ? { aspectRatio: `${image.width} / ${image.height}` } : undefined}
            >
              <Icon name="image" size={20} />
            </span>
          ) : (
            // biome-ignore lint/performance/noImgElement: 两种规格已由服务端生成（15 §11.3）
            <img
              ref={imgRef}
              className={styles.img}
              src={imageUrl(readingId, 'thumb')}
              alt=""
              width={image.width}
              height={image.height}
              decoding="async"
              draggable={false}
              onError={() => setFailed(true)}
            />
          )}
          <span className={styles.veil} data-photo-veil="" aria-hidden="true" />
        </span>
        {(['tl', 'br'] as const).map((at) => (
          <span key={at} className={styles.corner} data-at={at} data-ink="corner" aria-hidden="true" />
        ))}
      </button>
      {viewerMounted ? (
        <ImageViewer
          open={open}
          src={imageUrl(readingId, 'thumb')}
          fullSrc={imageUrl(readingId, 'full')}
          alt={alt}
          width={image.width}
          height={image.height}
          onClose={() => setOpen(false)}
          returnFocusTo={btnRef}
        />
      ) : null}
    </div>
  );
}

/** 提示页与错误页：没有落库的答案，只在提问下方写一行「附图一张」（15 §11.5） */
export function PhotoNote() {
  return (
    <p className={styles.note} data-ink="head" data-ink-block="">
      {zh.answer.photoNote}
    </p>
  );
}
