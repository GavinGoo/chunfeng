import '@fontsource-variable/source-serif-4';
import '@fontsource-variable/noto-serif-sc';
import '@/styles/tokens.css';
import '@/styles/fonts.css';
import '@/styles/globals.css';

import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { preload } from 'react-dom';
import { zh } from '@/copy/zh';
import { APPLE_SIZE, SEAL_SIZE } from '@/server/share/seal';

export const metadata: Metadata = {
  title: zh.meta.title,
  description: zh.meta.description,
  // 标签页 icon 用透明底的印章；iOS 主屏不支持透明（会垫黑），用铺满纸色底的那份（06 §5.1、D41、D42）。
  // 两份都由 `pnpm build:seal` 从同一个 Seal 组件生成。
  icons: {
    icon: [{ url: '/seal.png', type: 'image/png', sizes: `${SEAL_SIZE}x${SEAL_SIZE}` }],
    apple: [{ url: '/apple-touch-icon.png', sizes: `${APPLE_SIZE}x${APPLE_SIZE}` }],
  },
};

// 07 §3：viewport-fit=cover 以便处理安全区；键盘只缩小可视视口，不挤压布局视口
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  interactiveWidget: 'resizes-visual',
  themeColor: '#07060f',
  colorScheme: 'dark',
};

/** 子集字体：界面文案（400）与封面主标题（Chunfeng Title）首帧即以正确字体渲染（06 §3.2） */
const PRELOAD_FONTS = ['/fonts/ui-400.woff2', '/fonts/title.woff2'] as const;

export default function RootLayout({ children }: { children: ReactNode }) {
  for (const href of PRELOAD_FONTS) {
    preload(href, { as: 'font', type: 'font/woff2', crossOrigin: 'anonymous' });
  }
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
