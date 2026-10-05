'use client';

// 书外底部操作区（07 §4、11 §6）：
// - flipping：按已翻时长轮换的提示文案（0 / 3 / 8 / 20 s，交叉淡化）+ 「合上」文字链接；
// - 主人态：换个问题 · 再翻一次 · 分享；访客态：我也问问春风 · 分享（分享只对 ok 答案）；
// - pending：再翻一次的请求进行中，按钮置灰。

import { type Ref, useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { flippingHintAt, zh } from '@/copy/zh';
import styles from './ActionBar.module.css';

export type ActionBarView =
  | { kind: 'none' }
  | { kind: 'flipping'; since: number; canClose: boolean; withImage?: boolean }
  | { kind: 'owner'; pending: boolean }
  | { kind: 'visitor' };

export interface ActionBarProps {
  view: ActionBarView;
  onClose(): void;
  onRegenerate(): void;
  onShare(): void;
  onChangeQuestion(): void;
  onAskToo(): void;
  shareRef?: Ref<HTMLButtonElement>;
}

/** 翻页提示：按时长切换，前一句淡出、后一句淡入 */
function FlippingHint({ since, withImage }: { since: number; withImage?: boolean }) {
  const [now, setNow] = useState(() => performance.now());
  useEffect(() => {
    const t = setInterval(() => setNow(performance.now()), 250);
    return () => clearInterval(t);
  }, []);
  const text = flippingHintAt(Math.max(0, now - since), { withImage });
  const [shown, setShown] = useState<{ cur: string; prev: string | null }>({ cur: text, prev: null });
  if (shown.cur !== text) setShown({ cur: text, prev: shown.cur });
  return (
    <span className={styles.hint} data-testid="flipping-hint">
      {shown.prev ? (
        <span key={`p-${shown.prev}`} className={styles.hintOut} aria-hidden="true">
          {shown.prev}
        </span>
      ) : null}
      <span key={shown.cur} className={styles.hintIn}>
        {shown.cur}
      </span>
    </span>
  );
}

export function ActionBar({
  view,
  onClose,
  onRegenerate,
  onShare,
  onChangeQuestion,
  onAskToo,
  shareRef,
}: ActionBarProps) {
  return (
    <div className={styles.bar} data-view={view.kind} data-testid="action-bar">
      {view.kind === 'flipping' ? (
        <div key="flipping" className={styles.row}>
          <FlippingHint since={view.since} withImage={view.withImage} />
          <Button variant="link" className={styles.closeLink} onClick={onClose} inactive={!view.canClose}>
            {zh.flipping.close}
          </Button>
        </div>
      ) : view.kind === 'owner' ? (
        <div key="owner" className={styles.row}>
          <Button variant="link" onClick={onChangeQuestion}>
            {zh.actions.changeQuestion}
          </Button>
          <Button variant="primary" onClick={onRegenerate} inactive={view.pending}>
            {zh.actions.regenerate}
          </Button>
          <Button variant="secondary" icon="share" onClick={onShare} ref={shareRef}>
            {zh.actions.share}
          </Button>
        </div>
      ) : view.kind === 'visitor' ? (
        <div key="visitor" className={styles.row}>
          <Button variant="primary" onClick={onAskToo}>
            {zh.actions.askToo}
          </Button>
          <Button variant="secondary" icon="share" onClick={onShare} ref={shareRef}>
            {zh.actions.share}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
