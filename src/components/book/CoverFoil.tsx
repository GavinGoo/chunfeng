// 烫金文字（06 §5）：烫金渐变 + 压印阴影 + 高光扫过。
// 扫光只用 transform 实现：一条带遮罩的窗口向右平移，窗口里的亮色文字等量反向平移，
// 两者相抵，文字保持不动，只有「光」掠过字面。
// 浮雕（relief）：烫金在皮面上微微凸起——光从左上来，字面内缘左上亮、右下暗，字外右下落一道极细的投影。
// 用一个共享的 SVG 滤镜实现（FoilReliefDefs 须渲染在同一文档里，由封面负责）；封面的金线框也用它。

import type { ReactNode } from 'react';
import styles from './CoverFoil.module.css';

export interface FoilTextProps {
  children: ReactNode;
  /** loop：每 10 s 扫过一次（每次 2.6 s）（首次在进场后）；hover：祖先带 data-foil-hover 且被悬停时扫过一次；none：不扫光 */
  sheen?: 'loop' | 'hover' | 'none';
  /** 字缘微光：金箔边缘的一圈静态柔光 */
  glow?: boolean;
  /** 哑光金：压暗、低对比，不发光，浮雕高光更弱，扫光是一片更宽的柔光（封面主标题） */
  matte?: boolean;
  /** 浮雕：左上高光、右下暗部的斜面（需要页面上有 FoilReliefDefs） */
  relief?: boolean;
  className?: string;
}

export const FOIL_RELIEF_ID = 'chunfeng-foil-relief';
export const FOIL_RELIEF_FILTER = `url(#${FOIL_RELIEF_ID})`;
const FOIL_RELIEF_MATTE_ID = `${FOIL_RELIEF_ID}-matte`;
const FOIL_RELIEF_MATTE_FILTER = `url(#${FOIL_RELIEF_MATTE_ID})`;

export function FoilText({
  children,
  sheen = 'none',
  glow = false,
  matte = false,
  relief = false,
  className,
}: FoilTextProps) {
  return (
    <span
      className={`${styles.foil} ${className ?? ''}`}
      data-sheen={sheen}
      data-glow={glow || undefined}
      data-matte={matte || undefined}
      data-relief={relief || undefined}
    >
      <span className={styles.emboss} aria-hidden="true">
        {children}
      </span>
      <span
        className={styles.face}
        style={relief ? { filter: matte ? FOIL_RELIEF_MATTE_FILTER : FOIL_RELIEF_FILTER } : undefined}
      >
        {children}
      </span>
      {sheen === 'none' ? null : (
        <span className={styles.window} aria-hidden="true">
          <span className={styles.glint}>{children}</span>
        </span>
      )}
    </span>
  );
}

/**
 * 烫金浮雕滤镜（单位 px，与字号无关，所以大字上更含蓄）：
 * - 内缘：字形减去向右下平移的自身 → 左上内缘，提亮；反之 → 右下内缘，压暗；都裁回字形内
 * - 外缘：右下一道柔和的细投影，左上一线极淡的反光
 */
export function FoilReliefDefs() {
  return (
    <svg className={styles.defs} aria-hidden="true" focusable="false">
      <ReliefFilter id={FOIL_RELIEF_ID} lit={0.5} rim={0.08} />
      {/* 哑光：左上内缘的高光与外缘反光减半，斜面更钝 */}
      <ReliefFilter id={FOIL_RELIEF_MATTE_ID} lit={0.22} rim={0.03} />
    </svg>
  );
}

function ReliefFilter({ id, lit, rim }: { id: string; lit: number; rim: number }) {
  return (
    <filter id={id} x="-10%" y="-10%" width="120%" height="120%" colorInterpolationFilters="sRGB">
      <feOffset in="SourceAlpha" dx="0.6" dy="0.6" result="down" />
      <feComposite in="SourceAlpha" in2="down" operator="out" result="litEdge" />
      <feGaussianBlur in="litEdge" stdDeviation="0.3" result="litSoft" />
      <feFlood floodColor="#fff6dc" floodOpacity={lit} />
      <feComposite in2="litSoft" operator="in" />
      <feComposite in2="SourceAlpha" operator="in" result="lit" />

      <feOffset in="SourceAlpha" dx="-0.6" dy="-0.6" result="up" />
      <feComposite in="SourceAlpha" in2="up" operator="out" result="shadeEdge" />
      <feGaussianBlur in="shadeEdge" stdDeviation="0.3" result="shadeSoft" />
      <feFlood floodColor="#2a1804" floodOpacity="0.55" />
      <feComposite in2="shadeSoft" operator="in" />
      <feComposite in2="SourceAlpha" operator="in" result="shade" />

      <feGaussianBlur in="SourceAlpha" stdDeviation="0.4" />
      <feOffset dx="0.6" dy="0.8" result="dropAlpha" />
      <feFlood floodColor="#000" floodOpacity="0.5" />
      <feComposite in2="dropAlpha" operator="in" result="drop" />

      <feOffset in="SourceAlpha" dx="-0.5" dy="-0.5" result="rimAlpha" />
      <feFlood floodColor="#f5e7c1" floodOpacity={rim} />
      <feComposite in2="rimAlpha" operator="in" result="rim" />

      <feMerge>
        <feMergeNode in="drop" />
        <feMergeNode in="rim" />
        <feMergeNode in="SourceGraphic" />
        <feMergeNode in="lit" />
        <feMergeNode in="shade" />
      </feMerge>
    </filter>
  );
}
