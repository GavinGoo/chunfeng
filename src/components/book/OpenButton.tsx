'use client';

// 「翻开属于你的那页」（08 §3）。烫金文字，两侧细线，最小可点击区域 44×44。
//
//   <OpenButton ready held hidden />
// - ready：已有内容。否则呈禁用态（金色 40%，无光效），但只设 aria-disabled，点击仍会提交表单，
//   由 Cover 给出温和的引导（铭牌边框亮起 + 提示），不抖动；
// - held：已提交、等待视口稳定时保持按下态；
// - 它是表单的 submit 按钮，点击与在铭牌中按 Enter 走同一条提交路径。

import { zh } from '@/copy/zh';
import { FoilText } from './CoverFoil';
import styles from './OpenButton.module.css';

export interface OpenButtonProps {
  ready: boolean;
  held?: boolean;
  /** 不可聚焦、不可点击（已提交后淡出期间） */
  inert?: boolean;
}

export function OpenButton({ ready, held = false, inert = false }: OpenButtonProps) {
  return (
    <button
      type="submit"
      className={styles.button}
      aria-disabled={!ready || undefined}
      data-held={held || undefined}
      data-foil-hover=""
      tabIndex={inert ? -1 : undefined}
    >
      <span className={styles.rule} aria-hidden="true" />
      <span className={styles.text}>
        <span className={styles.breath} aria-hidden="true">
          {zh.cover.openButton}
        </span>
        <FoilText sheen="hover">{zh.cover.openButton}</FoilText>
      </span>
      <span className={styles.rule} aria-hidden="true" />
    </button>
  );
}
