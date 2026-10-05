import type { ReactElement } from 'react';
import { TITLE_FAMILY } from './fonts';

// 印章「春风」（12 §2、§5.3）：朱砂方印，两字竖排，纸色字，内侧一道细框；字体为书名子集「Chunfeng Title」（D20）。
// 分享图页眉用它（64 px）；`scripts/build-seal.ts` 用同一个组件生成两份 PNG：
//   public/seal.png             512 × 512 透明底 —— og:image + 浏览器 icon（D36、D39、D41）
//   public/apple-touch-icon.png 180 × 180 纸色底 —— iOS 主屏（不支持透明，会垫黑，D42）
// 颜色与 06 §2 的令牌同值：--cinnabar-600 / --paper-50。

const CINNABAR = '#a33b2a';
const PAPER50 = '#f4ecdc';

/** 页眉里的印章尺寸：其余尺寸都按它等比缩放，改这里会同时影响分享图与两份 icon */
const BASE = 64;

/** og:image 的画布与印章尺寸（D36）：512 × 512 透明画布，印章 384 px 居中 */
export const SEAL_SIZE = 512;
export const SEAL_ART_SIZE = 384;

/** apple-touch-icon 的画布与印章尺寸（D42）：180 × 180 是 iPhone 60 pt @3x */
export const APPLE_SIZE = 180;
export const APPLE_ART_SIZE = 135;

/** 纸色底（--paper-50）：只给需要不透明底的场合用（iOS 主屏图标） */
export const SEAL_PAPER = PAPER50;

export function Seal({ text, size = BASE }: { text: string; size?: number }): ReactElement {
  const k = size / BASE;
  return (
    <div
      style={{
        display: 'flex',
        width: size,
        height: size,
        backgroundColor: CINNABAR,
        borderRadius: 5 * k,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          width: 56 * k,
          height: 56 * k,
          border: `${1.5 * k}px solid rgba(244,236,220,.55)`,
          borderRadius: 3 * k,
          color: PAPER50,
          fontFamily: `'${TITLE_FAMILY}'`,
          fontWeight: 400,
          fontSize: 23 * k,
          lineHeight: 1,
        }}
      >
        {[...text].map((ch) => (
          <div key={ch} style={{ display: 'flex', margin: `${1 * k}px 0` }}>
            {ch}
          </div>
        ))}
      </div>
    </div>
  );
}
