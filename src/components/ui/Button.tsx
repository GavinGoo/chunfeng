'use client';

// 书外按钮（06 §7）：
// - primary：双线金框（「再翻一次」「我也问问春风」「再试一次」）
// - secondary：线描图标 + 文字（「分享」）
// - link：文字链接（「换个问题」「合上」）
// 不可用时用 aria-disabled（inactive），而不是 disabled：按钮仍可聚焦、可被读屏软件读到，点击被吞掉。

import type { ButtonHTMLAttributes, MouseEvent, ReactNode, Ref } from 'react';
import styles from './Button.module.css';
import { Icon, type IconName } from './Icon';

export type ButtonVariant = 'primary' | 'secondary' | 'link';

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'disabled'> {
  variant?: ButtonVariant;
  /** 左侧线描图标（通常用于 secondary） */
  icon?: IconName;
  /** 不可用：aria-disabled="true"，点击不触发 onClick */
  inactive?: boolean;
  /** 强调一次（如「再试一次」在网络恢复后高亮） */
  highlight?: boolean;
  children: ReactNode;
  ref?: Ref<HTMLButtonElement>;
}

export function Button({
  variant = 'primary',
  icon,
  inactive = false,
  highlight = false,
  className,
  onClick,
  children,
  type = 'button',
  ref,
  ...rest
}: ButtonProps) {
  const handleClick = (e: MouseEvent<HTMLButtonElement>) => {
    if (inactive) {
      e.preventDefault();
      return;
    }
    onClick?.(e);
  };
  const cls = [styles.button, styles[variant], highlight ? styles.highlight : '', className ?? '']
    .filter(Boolean)
    .join(' ');
  return (
    <button
      ref={ref}
      type={type}
      className={cls}
      aria-disabled={inactive || undefined}
      onClick={handleClick}
      {...rest}
    >
      {variant === 'primary' ? (
        <>
          <span className={styles.glow} aria-hidden="true" />
          <span className={styles.sheen} aria-hidden="true" />
        </>
      ) : null}
      {icon ? <Icon name={icon} size={18} className={styles.icon} /> : null}
      <span className={styles.label}>{children}</span>
    </button>
  );
}
