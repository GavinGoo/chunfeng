'use client';

// 弹层的焦点管理（12 §4、15 §11.4）：打开时锁定背景滚动并聚焦指定元素；Tab 困在弹层内；Esc 关闭；
// 关闭后焦点回到触发元素。分享弹层与查看大图共用。

import { type KeyboardEvent, type RefObject, useCallback, useEffect, useRef } from 'react';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function useModalFocus({
  open,
  panelRef,
  initialFocusRef,
  returnFocusTo,
  onClose,
}: {
  open: boolean;
  panelRef: RefObject<HTMLElement | null>;
  initialFocusRef: RefObject<HTMLElement | null>;
  returnFocusTo?: RefObject<HTMLElement | null>;
  onClose(): void;
}): (e: KeyboardEvent<HTMLElement>) => void {
  // Esc：焦点尚未进入弹层（如移动端，或初始聚焦前）时也要能关闭
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      const panel = panelRef.current;
      if (panel && e.target instanceof Node && panel.contains(e.target)) return; // 由面板上的 onKeyDown 处理
      onCloseRef.current();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, panelRef]);

  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const focusTimer = setTimeout(() => initialFocusRef.current?.focus({ preventScroll: true }), 30);
    const returnTarget = returnFocusTo?.current ?? null;
    return () => {
      clearTimeout(focusTimer);
      document.body.style.overflow = prevOverflow;
      (returnFocusTo?.current ?? returnTarget)?.focus?.({ preventScroll: true });
    };
  }, [open, returnFocusTo, initialFocusRef]);

  return useCallback(
    (e: KeyboardEvent<HTMLElement>) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        return;
      }
      const panel = panelRef.current;
      if (e.key !== 'Tab' || !panel) return;
      const nodes = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (n) => n.offsetParent !== null || n === document.activeElement,
      );
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (!first || !last) {
        e.preventDefault();
        return;
      }
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !panel.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !panel.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    },
    [onClose, panelRef],
  );
}
