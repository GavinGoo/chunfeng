// 生成印章 PNG（12 §2、§5.3、06 §5.1）：与分享图页眉里那枚印章同源（同一个 `Seal` 组件），一次输出两份：
//   public/seal.png             512 × 512 透明底 —— 答案页 og:image（D36、D39）+ 浏览器 icon（D41）
//   public/apple-touch-icon.png 180 × 180 纸色底 —— iOS 主屏图标（D42）
// 两者都是静态文件：爬虫抓 og:image 不会再触发分享图渲染，图片里也不含任何域名。
//
// 用法：pnpm build:seal（输出入库；改印章样式后重新运行即可）

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ImageResponse } from 'next/og';
import { createElement, type ReactElement } from 'react';
import { zh } from '../src/copy/zh';
import { titleFont } from '../src/server/share/fonts';
import {
  APPLE_ART_SIZE,
  APPLE_SIZE,
  SEAL_ART_SIZE,
  SEAL_PAPER,
  SEAL_SIZE,
  Seal,
} from '../src/server/share/seal';

const text = zh.share.image.seal;

/** 方画布 + 居中的印章；不给 background 时画布透明 */
function frame(size: number, artSize: number, background?: string): ReactElement {
  return createElement(
    'div',
    {
      style: {
        display: 'flex',
        width: size,
        height: size,
        alignItems: 'center',
        justifyContent: 'center',
        ...(background ? { backgroundColor: background } : {}),
      },
    },
    createElement(Seal, { text, size: artSize }),
  );
}

const outputs = [
  {
    file: 'public/seal.png',
    size: SEAL_SIZE,
    element: frame(SEAL_SIZE, SEAL_ART_SIZE), // 透明底：叠在链接卡片与标签页的任何底色上都成立
  },
  {
    file: 'public/apple-touch-icon.png',
    size: APPLE_SIZE,
    element: frame(APPLE_SIZE, APPLE_ART_SIZE, SEAL_PAPER), // iOS 不支持透明，铺满纸色底
  },
];

for (const { file, size, element } of outputs) {
  const res = new ImageResponse(element, { width: size, height: size, fonts: [titleFont()] });
  const png = Buffer.from(await res.arrayBuffer());
  const out = path.join(process.cwd(), file);
  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(out, png);
  console.log(`${file}  ${size}×${size}  ${(png.length / 1024).toFixed(1)} KB`);
}
