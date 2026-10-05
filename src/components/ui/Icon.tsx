// 自绘线描图标（06 §7）：1.25 px 线宽、圆角端点，只有五个（第 5 个「附图」见 15 §10.1）。
// 线宽用 non-scaling-stroke 固定为 1.25 CSS px，不随图标尺寸缩放。

import type { SVGProps } from 'react';

export type IconName = 'share' | 'reflip' | 'chevron' | 'close' | 'image';

const PATHS: Record<IconName, readonly string[]> = {
  // 分享：自托盘中升起的箭头
  share: [
    'M12 14.5V4',
    'M8.25 7.5 12 3.75l3.75 3.75',
    'M6 11.5v6.75c0 .83.67 1.5 1.5 1.5h9c.83 0 1.5-.67 1.5-1.5V11.5',
  ],
  // 再翻：摊开的书，一页正从书脊掀起
  reflip: [
    'M12 19.25c-1.9-1.15-4.4-1.6-7.75-1.35V6.1c3.35-.25 5.85.2 7.75 1.35',
    'M12 19.25V7.45',
    'M12 19.25c1.9-1.15 4.4-1.6 7.75-1.35V9.5',
    'M12 7.45c.95-2.05 2.85-3.3 5.6-3.7l.35 10.1c-2.75.4-4.8 2.1-5.95 5.4',
  ],
  // 展开箭头
  chevron: ['M6.5 9.5 12 15l5.5-5.5'],
  // 关闭
  close: ['M6.75 6.75l10.5 10.5', 'M17.25 6.75 6.75 17.25'],
  // 附图：线描方框里一道山线与一弯新月
  image: [
    'M5.25 5.25h13.5c.83 0 1.5.67 1.5 1.5v10.5c0 .83-.67 1.5-1.5 1.5H5.25c-.83 0-1.5-.67-1.5-1.5V6.75c0-.83.67-1.5 1.5-1.5Z',
    'M4 16.25l4.4-4.1 3.1 2.9 2.6-2.35 5.9 5.05',
    'M16.4 7.6a1.9 1.9 0 1 0 1.55 2.95 1.5 1.5 0 0 1-1.55-2.95Z',
  ],
};

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'children'> {
  name: IconName;
  /** 边长（px），默认 20 */
  size?: number;
}

export function Icon({ name, size = 20, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.25}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {PATHS[name].map((d) => (
        <path key={d} d={d} vectorEffect="non-scaling-stroke" />
      ))}
    </svg>
  );
}
