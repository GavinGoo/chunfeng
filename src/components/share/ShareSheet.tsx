'use client';

// 分享弹层（12 §4）：移动端为底部抽屉，桌面端为居中弹层。
// - 图片使用真实的 http(s) URL（微信中长按才能保存 / 识别二维码）；
// - 加载前显示同比例的纸色骨架与缓慢光带；失败时「重试」追加 &r=n 绕过缓存；
// - 「复制链接」始终可用：Clipboard API → execCommand → 提示手动长按复制（05 §7）；
// - role="dialog" aria-modal、焦点困在弹层内、Esc 关闭、关闭后焦点回到触发按钮。

import { type RefObject, useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { LiveRegion, type LiveRegionHandle } from '@/components/ui/LiveRegion';
import { useModalFocus } from '@/components/ui/useModalFocus';
import { formatDownloadName, formatShareAlt, zh } from '@/copy/zh';
import styles from './ShareSheet.module.css';
import { detectShareEnv, type ShareEnvKind, shareImageUrl } from './shareEnv';

export interface ShareSheetProps {
  open: boolean;
  readingId: string;
  question: string;
  onClose(): void;
  /** 关闭后焦点回到这里（通常是「分享」按钮） */
  returnFocusTo?: RefObject<HTMLElement | null>;
  /** 带图答案：图片下方提示「分享图中含有你附上的图片」（15 §12） */
  hasPhoto?: boolean;
}

type ImageState = 'loading' | 'loaded' | 'error';
type CopyState = 'idle' | 'copied' | 'failed';

const EXIT_MS = 320;
const TOAST_MS = 1600;

function copyViaExecCommand(text: string): boolean {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  ta.style.inset = '0 auto auto 0';
  document.body.appendChild(ta);
  const active = document.activeElement as HTMLElement | null;
  ta.select();
  ta.setSelectionRange(0, text.length);
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  ta.remove();
  active?.focus?.();
  return ok;
}

export function ShareSheet({
  open,
  readingId,
  question,
  onClose,
  returnFocusTo,
  hasPhoto = false,
}: ShareSheetProps) {
  // 挂载 / 退场：关闭后保留 EXIT_MS 用于退场动画
  const [rendered, setRendered] = useState(open);
  const [visible, setVisible] = useState(false);
  const [env, setEnv] = useState<ShareEnvKind>('mobile');
  const [layout, setLayout] = useState<'drawer' | 'dialog'>('drawer');
  const [retry, setRetry] = useState(0);
  const [imageState, setImageState] = useState<ImageState>('loading');
  const [copyState, setCopyState] = useState<CopyState>('idle');
  const [sharing, setSharing] = useState(false);

  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const linkInputRef = useRef<HTMLInputElement>(null);
  const liveRef = useRef<LiveRegionHandle>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const titleId = useId();

  const src = shareImageUrl(readingId, retry);
  const [link, setLink] = useState(`/a/${readingId}`);

  useEffect(() => {
    if (open) {
      setRendered(true);
      setEnv(detectShareEnv());
      const narrow = window.matchMedia('(max-width: 640px), (hover: none) and (pointer: coarse)').matches;
      setLayout(narrow ? 'drawer' : 'dialog');
      setLink(`${window.location.origin}/a/${readingId}`);
      setCopyState('idle');
      // 下一帧再加可见类，触发入场过渡
      const raf = requestAnimationFrame(() => requestAnimationFrame(() => setVisible(true)));
      return () => cancelAnimationFrame(raf);
    }
    setVisible(false);
    const t = setTimeout(() => setRendered(false), EXIT_MS);
    return () => clearTimeout(t);
  }, [open, readingId]);

  // 换一篇答案时重新加载图片
  // biome-ignore lint/correctness/useExhaustiveDependencies: readingId 变化即重置
  useEffect(() => {
    setRetry(0);
    setImageState('loading');
  }, [readingId]);

  // 打开时：锁定背景滚动，聚焦关闭按钮；关闭时：焦点回到触发按钮；Tab 困在弹层内、Esc 关闭
  const onKeyDown = useModalFocus({ open, panelRef, initialFocusRef: closeRef, returnFocusTo, onClose });

  useEffect(() => () => clearTimeout(toastTimer.current), []);

  const showToast = useCallback((state: CopyState) => {
    setCopyState(state);
    clearTimeout(toastTimer.current);
    if (state === 'copied') {
      liveRef.current?.announce(zh.live.copied);
      toastTimer.current = setTimeout(() => setCopyState('idle'), TOAST_MS);
    } else if (state === 'failed') {
      liveRef.current?.announce(zh.share.copyFailed);
      // 选中可见的链接，方便手动复制
      requestAnimationFrame(() => {
        linkInputRef.current?.focus();
        linkInputRef.current?.select();
      });
    }
  }, []);

  const onCopy = useCallback(async () => {
    try {
      if (navigator.clipboard?.writeText && window.isSecureContext) {
        await navigator.clipboard.writeText(link);
        showToast('copied');
        return;
      }
    } catch {
      // 落到 execCommand
    }
    showToast(copyViaExecCommand(link) ? 'copied' : 'failed');
  }, [link, showToast]);

  const onShareFile = useCallback(async () => {
    if (sharing) return;
    setSharing(true);
    try {
      const res = await fetch(src);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const file = new File([blob], formatDownloadName(readingId), { type: 'image/png' });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: zh.share.shareTitle });
      } else {
        await navigator.share({ title: zh.share.shareTitle, url: link });
      }
    } catch (e) {
      // 用户取消（AbortError）不提示；其他失败时图片仍可长按保存，不打断
      if (!(e instanceof DOMException && e.name === 'AbortError')) setEnv('mobile');
    } finally {
      setSharing(false);
    }
  }, [sharing, src, readingId, link]);

  const onRetry = useCallback(() => {
    setImageState('loading');
    setRetry((n) => n + 1);
  }, []);

  if (!rendered || typeof document === 'undefined') return null;

  const showLongPress = env !== 'desktop';
  const hint = env === 'wechat' ? zh.share.wechatHint : zh.share.longPressHint;

  return createPortal(
    <div
      className={[styles.root, styles[layout], visible ? styles.visible : ''].join(' ')}
      data-env={env}
      data-testid="share-sheet"
    >
      <div className={styles.overlay} aria-hidden="true" onClick={onClose} />
      <div
        ref={panelRef}
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={onKeyDown}
      >
        <h2 id={titleId} className={styles.title}>
          {zh.share.dialogLabel}
        </h2>
        <button
          ref={closeRef}
          type="button"
          className={styles.close}
          aria-label={zh.share.close}
          onClick={onClose}
        >
          <Icon name="close" size={20} />
        </button>

        <div className={styles.figure}>
          <div className={styles.frame} data-state={imageState}>
            {imageState !== 'error' ? (
              // biome-ignore lint/performance/noImgElement: 必须是真实 URL 的 <img>，微信长按才能保存与识别
              <img
                key={src}
                src={src}
                alt={formatShareAlt(question)}
                className={styles.image}
                width={1080}
                height={1620}
                decoding="async"
                onLoad={() => {
                  setImageState('loaded');
                  liveRef.current?.announce(zh.share.imageReady);
                }}
                onError={() => setImageState('error')}
              />
            ) : null}
            {imageState === 'loading' ? (
              <div className={styles.skeleton} role="img" aria-label={zh.share.imageLoading}>
                <span className={styles.sweep} aria-hidden="true" />
              </div>
            ) : null}
            {imageState === 'error' ? (
              <div className={styles.failed}>
                <p>{zh.share.imageFailed}</p>
                <Button variant="link" onClick={onRetry}>
                  {zh.share.imageRetry}
                </Button>
              </div>
            ) : null}
          </div>
        </div>

        {hasPhoto ? <p className={styles.photoNote}>{zh.share.containsPhoto}</p> : null}
        {showLongPress && imageState === 'loaded' ? <p className={styles.hint}>{hint}</p> : null}

        <div className={styles.actions}>
          {env === 'mobileShare' ? (
            <Button variant="primary" onClick={onShareFile} inactive={sharing || imageState !== 'loaded'}>
              {zh.share.shareImage}
            </Button>
          ) : null}
          {env === 'desktop' ? (
            <a
              className={styles.download}
              href={src}
              download={formatDownloadName(readingId)}
              aria-disabled={imageState !== 'loaded' || undefined}
              onClick={(e) => {
                if (imageState !== 'loaded') e.preventDefault();
              }}
            >
              <span className={styles.downloadLabel}>{zh.share.download}</span>
            </a>
          ) : null}
          <Button variant="secondary" icon="share" onClick={onCopy}>
            {zh.share.copyLink}
          </Button>
        </div>

        {copyState === 'failed' ? (
          <div className={styles.manual}>
            <label className={styles.manualLabel} htmlFor={`${titleId}-link`}>
              {zh.share.copyFailed}
            </label>
            <input
              ref={linkInputRef}
              id={`${titleId}-link`}
              className={styles.manualInput}
              value={link}
              readOnly
              aria-label={zh.share.linkLabel}
              onFocus={(e) => e.currentTarget.select()}
            />
          </div>
        ) : null}

        <div className={styles.toast} data-show={copyState === 'copied' || undefined} aria-hidden="true">
          {zh.share.copied}
        </div>
        <LiveRegion ref={liveRef} />
      </div>
    </div>,
    document.body,
  );
}
