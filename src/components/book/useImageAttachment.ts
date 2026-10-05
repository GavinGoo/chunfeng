'use client';

// 封面附图的状态（15 §10.3–§10.8）：选图即上传；上传中可以继续写问题；提交时等待上传结束。
// 删除时取消进行中的上传、释放 blob URL、清除草稿中的图片。刷新后从 sessionStorage 恢复草稿。

import { useCallback, useEffect, useRef, useState } from 'react';
import { formatLiveImageFailed, type ImageFailReason, zh } from '@/copy/zh';
import type { ClientError } from '@/lib/client/createReading';
import { prepareImage } from '@/lib/client/image';
import { clearDraftImage, getDraftImage, setDraftImage } from '@/lib/client/storage';
import { uploadImage } from '@/lib/client/uploadImage';

export type AttachmentStatus = 'none' | 'uploading' | 'ready' | 'failed';

export interface AttachmentView {
  status: AttachmentStatus;
  /** 缩略图与预览的图片源：blob URL，或草稿中的小图；原样上传的图片没有 */
  previewUrl?: string;
  imageId?: string;
  failReason?: ImageFailReason;
  retryAfterMs?: number;
}

export type SettledAttachment = { kind: 'none' } | { kind: 'ready'; imageId: string } | { kind: 'failed' };

export interface UseImageAttachment {
  view: AttachmentView;
  attach(file: File): void;
  remove(): void;
  retry(): void;
  /** 提交时调用：等上传结束（最长 30 s 的上传超时由 uploadImage 保证） */
  settled(): Promise<SettledAttachment>;
  /** 得到答案或图片失效时清除（不播报） */
  clear(): void;
}

const NONE: AttachmentView = { status: 'none' };

function reasonFor(e: ClientError): ImageFailReason {
  switch (e.code) {
    case 'PAYLOAD_TOO_LARGE':
      return 'tooLarge';
    case 'UNSUPPORTED_MEDIA':
      return 'unsupported';
    case 'IMAGE_UNREADABLE':
      return 'unreadable';
    case 'RATE_LIMITED':
      return 'rateLimited';
    default:
      return 'network';
  }
}

export function useImageAttachment(opts: {
  enabled: boolean;
  announce?(message: string): void;
  /** 服务端返回 VISION_DISABLED：本次会话隐藏附图入口 */
  onDisabled?(): void;
}): UseImageAttachment {
  const [view, setView] = useState<AttachmentView>(NONE);
  const viewRef = useRef(view);
  viewRef.current = view;
  const fileRef = useRef<File | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const jobRef = useRef<Promise<void> | null>(null);
  const blobUrlRef = useRef<string | null>(null);
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const releaseBlob = useCallback(() => {
    if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
    blobUrlRef.current = null;
  }, []);

  const update = useCallback((next: AttachmentView) => {
    viewRef.current = next;
    setView(next);
  }, []);

  // 恢复草稿（挂载时）
  useEffect(() => {
    if (!opts.enabled) return;
    const d = getDraftImage();
    if (d) update({ status: 'ready', imageId: d.imageId, previewUrl: d.thumb });
  }, [opts.enabled, update]);

  useEffect(
    () => () => {
      abortRef.current?.abort();
      releaseBlob();
    },
    [releaseBlob],
  );

  const run = useCallback(
    (file: File) => {
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      const announce = (m: string) => optsRef.current.announce?.(m);
      const job = (async () => {
        update({ ...viewRef.current, status: 'uploading', imageId: undefined, failReason: undefined });
        announce(zh.live.imageUploading);
        const prepared = await prepareImage(file);
        if (ac.signal.aborted) return;
        if (!prepared.ok) {
          update({ status: 'failed', previewUrl: viewRef.current.previewUrl, failReason: prepared.reason });
          announce(formatLiveImageFailed(prepared.reason));
          return;
        }
        if (prepared.previewUrl) {
          releaseBlob();
          blobUrlRef.current = prepared.previewUrl;
        }
        const previewUrl = prepared.previewUrl ?? viewRef.current.previewUrl;
        update({ status: 'uploading', previewUrl });
        const res = await uploadImage(prepared.blob, { signal: ac.signal });
        if (ac.signal.aborted) return;
        if (res.ok) {
          update({ status: 'ready', previewUrl, imageId: res.data.imageId });
          setDraftImage({
            imageId: res.data.imageId,
            width: res.data.width,
            height: res.data.height,
            thumb: prepared.draftThumb,
          });
          announce(zh.live.imageReady);
          return;
        }
        if (res.error.code === 'VISION_DISABLED') {
          releaseBlob();
          update(NONE);
          clearDraftImage();
          optsRef.current.onDisabled?.();
          return;
        }
        const reason = reasonFor(res.error);
        update({ status: 'failed', previewUrl, failReason: reason, retryAfterMs: res.error.retryAfterMs });
        announce(formatLiveImageFailed(reason, res.error.retryAfterMs));
      })();
      jobRef.current = job;
      void job.finally(() => {
        if (jobRef.current === job) jobRef.current = null;
      });
    },
    [update, releaseBlob],
  );

  const attach = useCallback(
    (file: File) => {
      // 已附一张时再附即为替换
      fileRef.current = file;
      clearDraftImage();
      releaseBlob();
      update({ status: 'uploading' });
      run(file);
    },
    [run, releaseBlob, update],
  );

  const retry = useCallback(() => {
    if (fileRef.current && viewRef.current.status === 'failed') run(fileRef.current);
  }, [run]);

  const clear = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    fileRef.current = null;
    releaseBlob();
    clearDraftImage();
    update(NONE);
  }, [releaseBlob, update]);

  const remove = useCallback(() => {
    clear();
    optsRef.current.announce?.(zh.live.imageRemoved);
  }, [clear]);

  const settled = useCallback(async (): Promise<SettledAttachment> => {
    // 上传在进行：等它结束（期间可能被删除或替换，循环直到稳定）
    for (let i = 0; i < 4 && jobRef.current; i++) await jobRef.current;
    const v = viewRef.current;
    if (v.status === 'ready' && v.imageId) return { kind: 'ready', imageId: v.imageId };
    if (v.status === 'none') return { kind: 'none' };
    return { kind: 'failed' };
  }, []);

  return { view, attach, remove, retry, settled, clear };
}
