'use client';

// 分享弹层开发台：POST /api/readings（需 MOCK_UPSTREAMS=true 以免消耗额度）新建答案，然后打开 ShareSheet。
// 开发工具页，文案不进入 UI 子集字体。

import { useCallback, useEffect, useRef, useState } from 'react';
import { ShareSheet } from '@/components/share/ShareSheet';
import { Button } from '@/components/ui/Button';
import { randomUUID } from '@/lib/client/uuid';
import type { CreateReadingResponse } from '@/lib/shared/types';
import styles from './harness.module.css';

const SAMPLES = [
  '工作三年了，要不要跳槽去创业公司？',
  '要不要把 MacBook Pro 换成 ThinkPad X1 Carbon，顺便学 Rust 和 TypeScript？',
  '我該不該辭職去環遊世界，還是繼續留在臺北工作？',
  '周末去海边🏖️还是进山🌲？👨‍👩‍👧 一家人都想去 🇨🇳',
  '去吗',
  `${'这是一个很长的问题，'.repeat(19)}到底该怎么办？`.slice(0, 200),
];

interface Current {
  id: string;
  question: string;
}

export function ShareHarness() {
  const [current, setCurrent] = useState<Current | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const shareBtn = useRef<HTMLButtonElement>(null);

  const create = useCallback(async (question: string) => {
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/readings', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ question, requestId: randomUUID(), tz: 'Asia/Shanghai' }),
      });
      const json = (await res.json()) as CreateReadingResponse | { error: { code: string } };
      if ('status' in json && json.status === 'ok') {
        setCurrent({ id: json.reading.id, question: json.reading.question });
        const url = new URL(window.location.href);
        url.searchParams.set('id', json.reading.id);
        window.history.replaceState(null, '', url);
        setOpen(true);
      } else {
        setError(JSON.stringify(json));
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  // ?id= 打开已有答案；?open=0 不自动打开
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const id = params.get('id');
    if (!id) return;
    fetch(`/api/readings/${id}`)
      .then((r) => r.json())
      .then((j: { reading?: { id: string; question: string } }) => {
        if (j.reading) {
          setCurrent({ id: j.reading.id, question: j.reading.question });
          if (params.get('open') !== '0') setOpen(true);
        }
      })
      .catch(() => undefined);
  }, []);

  return (
    <main className={styles.page}>
      <h1 className={styles.h1}>ShareSheet · dev</h1>
      <ul className={styles.list}>
        {SAMPLES.map((q) => (
          <li key={q}>
            <button type="button" className={styles.sample} disabled={busy} onClick={() => create(q)}>
              {q}
            </button>
          </li>
        ))}
      </ul>
      {current ? (
        <p className={styles.meta}>
          id: <code>{current.id}</code> · <a href={`/api/readings/${current.id}/share-image`}>PNG</a>
        </p>
      ) : null}
      {error ? <pre className={styles.error}>{error}</pre> : null}
      <Button
        ref={shareBtn}
        variant="secondary"
        icon="share"
        inactive={!current}
        onClick={() => setOpen(true)}
      >
        Share
      </Button>
      {current ? (
        <ShareSheet
          open={open}
          hasPhoto={new URLSearchParams(typeof window === 'undefined' ? '' : window.location.search).has(
            'photo',
          )}
          readingId={current.id}
          question={current.question}
          onClose={() => setOpen(false)}
          returnFocusTo={shareBtn}
        />
      ) : null}
    </main>
  );
}
