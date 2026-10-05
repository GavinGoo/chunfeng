// 视觉隐藏、屏幕阅读器可读的文本

import type { CSSProperties, ElementType, ReactNode } from 'react';

const style: CSSProperties = {
  position: 'absolute',
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  clipPath: 'inset(50%)',
  whiteSpace: 'nowrap',
  border: 0,
};

export interface VisuallyHiddenProps {
  children: ReactNode;
  /** 渲染的元素，默认 span */
  as?: ElementType;
  id?: string;
}

export function VisuallyHidden({ children, as: Tag = 'span', id }: VisuallyHiddenProps) {
  return (
    <Tag id={id} style={style}>
      {children}
    </Tag>
  );
}
