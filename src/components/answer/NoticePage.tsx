'use client';

// 提示页与错误页（11 §7）：同样写在纸页上，同样以墨迹显现。
// 竖屏：提问 / 分割线 / 标题与正文 / 页上的操作；横屏：左页提问，右页标题与正文。

import { Fragment, useEffect, useState } from 'react';
import { fill, formatCountdown, zh } from '@/copy/zh';
import type { HelpResource } from '@/lib/shared/types';
import styles from './AnswerPage.module.css';
import { Folio, Question, Rule, WindOrnament } from './blocks';
import { splitPhones, telHref } from './labels';
import { describeNotice, type NoticeInput, type PageAction } from './notice';
import { PhotoNote } from './Photo';
import { ScrollArea } from './ScrollArea';

export interface NoticePageProps {
  model: NoticeInput & { question?: string; hasImage?: boolean };
  mode: 'single' | 'spread';
  compact: boolean;
  onAction?(a: PageAction): void;
  retryAvailableAt?: number;
  online?: boolean;
}

/** 倒计时：挂载前（含 SSR）以 retryAfterMs 估算，保证水合一致 */
function useRemainingMs(
  retryAvailableAt: number | undefined,
  retryAfterMs: number | undefined,
  active: boolean,
) {
  const [deadline, setDeadline] = useState<number | undefined>(retryAvailableAt);
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    if (!active) return;
    const start = Date.now();
    setDeadline(retryAvailableAt ?? (retryAfterMs ? start + retryAfterMs : undefined));
    setNow(start);
  }, [active, retryAvailableAt, retryAfterMs]);

  useEffect(() => {
    if (!active || deadline === undefined || now === null || now >= deadline) return;
    const t = setTimeout(() => setNow(Date.now()), Math.min(1000, deadline - now) || 250);
    return () => clearTimeout(t);
  }, [active, deadline, now]);

  if (!active) return 0;
  if (now === null) return retryAfterMs ?? 0;
  return deadline === undefined ? 0 : Math.max(0, deadline - now);
}

function Resources({ resources }: { resources: HelpResource[] }) {
  if (resources.length === 0) return null;
  return (
    <div className={styles.resources} data-ink="item" data-ink-block="">
      <p className={styles.resourcesTitle}>{zh.notice.sensitive.resourcesTitle}</p>
      <ul className={styles.resourceList}>
        {resources.map((r) =>
          'url' in r ? (
            <li key={`${r.name}-${r.url}`} className={styles.resource}>
              <a className={styles.resourceLink} href={r.url} target="_blank" rel="noopener noreferrer">
                {r.note ?? r.name}
              </a>
            </li>
          ) : (
            <li key={`${r.name}-${r.phone}`} className={styles.resource}>
              <span className={styles.resourceName}>{r.note ?? r.name}</span>
              <span className={styles.phones}>
                {splitPhones(r.phone).map((p, i) => (
                  <Fragment key={p}>
                    {i > 0 ? <span className={styles.phoneSep}> / </span> : null}
                    <a className={styles.phone} href={telHref(p)}>
                      {p}
                    </a>
                  </Fragment>
                ))}
              </span>
            </li>
          ),
        )}
      </ul>
    </div>
  );
}

export function NoticePage({ model, mode, compact, onAction, retryAvailableAt, online }: NoticePageProps) {
  const d = describeNotice(model);
  const error = model.kind === 'error' ? model.error : undefined;
  const remaining = useRemainingMs(retryAvailableAt, error?.retryAfterMs, d.countdown);
  const waiting = remaining > 0;
  const seconds = Math.max(1, Math.ceil(remaining / 1000));

  // RATE_LIMITED：补充句里的秒数实时更新，归零后换成「可以再试」
  let extra = d.extra;
  if (error?.code === 'RATE_LIMITED') {
    extra = waiting ? fill(zh.error.extra.RATE_LIMITED, { seconds }) : zh.error.rateLimitReady;
  }
  const showCountdown = waiting && error?.code !== 'RATE_LIMITED';
  const countdownId = `cd-${d.variant}`;
  const question = model.kind === 'notFound' ? undefined : model.question;
  const hasImage = model.kind !== 'notFound' && !!model.hasImage;

  const notice = (
    <div className={styles.notice} data-variant={d.variant}>
      <h3 className={styles.noticeTitle} data-ink="item" data-ink-block="" tabIndex={-1}>
        {d.title}
      </h3>
      <p className={styles.noticeBody} data-ink="item" data-ink-block="">
        {d.body}
        {extra ? <span className={styles.noticeExtra}>{extra}</span> : null}
      </p>
      {d.resources ? <Resources resources={d.resources} /> : null}
      <div className={styles.actions} data-ink="item" data-ink-block="">
        {d.actions.map((a) => {
          const inactive = a.action === 'retry' && waiting;
          const highlight = a.action === 'retry' && d.variant === 'offline' && online === true;
          return (
            <button
              key={a.action}
              type="button"
              className={a.primary ? styles.paperButton : styles.paperLink}
              data-highlight={highlight || undefined}
              aria-disabled={inactive || undefined}
              aria-describedby={inactive && showCountdown ? countdownId : undefined}
              onClick={() => {
                if (!inactive) onAction?.(a.action);
              }}
            >
              {a.label}
            </button>
          );
        })}
      </div>
      {showCountdown ? (
        <p id={countdownId} className={styles.countdown}>
          {formatCountdown(remaining)}
        </p>
      ) : null}
    </div>
  );

  if (mode === 'spread') {
    return (
      <>
        <div className={styles.page} data-side="left">
          <ScrollArea className={styles.leftScroll}>
            <div className={styles.leftBody}>
              {question ? <Question question={question} compact={compact} large /> : null}
              {hasImage ? <PhotoNote /> : null}
              <WindOrnament />
            </div>
          </ScrollArea>
          <Folio show="label" />
        </div>
        <div className={styles.page} data-side="right">
          <ScrollArea className={styles.centerScroll}>{notice}</ScrollArea>
        </div>
      </>
    );
  }

  return (
    <div className={styles.page}>
      <ScrollArea className={question ? undefined : styles.centerScroll}>
        {question ? (
          <>
            <Question question={question} compact={compact} quiet />
            {hasImage ? <PhotoNote /> : null}
            <Rule />
          </>
        ) : null}
        {notice}
      </ScrollArea>
      {question ? <Folio show="label" /> : null}
    </div>
  );
}
