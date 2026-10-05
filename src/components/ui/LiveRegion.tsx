'use client';

// 屏幕阅读器播报区（07 §8）。两种用法：
// 1. 受控：<LiveRegion message={text} />，message 变化时播报；
// 2. 命令式：const ref = useRef<LiveRegionHandle>(null); ref.current?.announce('…')。
// 同一句话重复播报时，先清空再写入，保证读屏软件会再次朗读。

import { type Ref, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { VisuallyHidden } from './VisuallyHidden';

export interface LiveRegionHandle {
  announce(message: string): void;
}

export interface LiveRegionProps {
  message?: string;
  politeness?: 'polite' | 'assertive';
  ref?: Ref<LiveRegionHandle>;
}

/** 清空与写入之间的间隔：足够让读屏软件察觉到内容变化 */
const RESET_MS = 60;

export function LiveRegion({ message, politeness = 'polite', ref }: LiveRegionProps) {
  const [text, setText] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const announce = useCallback((next: string) => {
    clearTimeout(timer.current);
    setText('');
    timer.current = setTimeout(() => setText(next), RESET_MS);
  }, []);

  useImperativeHandle(ref, () => ({ announce }), [announce]);

  useEffect(() => {
    if (message) announce(message);
  }, [message, announce]);

  useEffect(() => () => clearTimeout(timer.current), []);

  return (
    <VisuallyHidden>
      <span role={politeness === 'assertive' ? 'alert' : 'status'} aria-live={politeness} aria-atomic="true">
        {text}
      </span>
    </VisuallyHidden>
  );
}
