'use client';

// 答案页开发台：按当前视口计算书的几何，在纸页上渲染 PageContent。
// URL 参数（便于截图）：sample=<键> revealed=0|1 auto=1（挂载后自动显现） expand=A,B panel=0（隐藏控制面板）
// resetHint=1（清除「已看过引导」）

import { useCallback, useEffect, useRef, useState } from 'react';
import { PageContent, type PageContentHandle } from '@/components/answer';
import { type BookGeometry, computeGeometry } from '@/components/book/geometry';
import { STORAGE_KEYS, safeRemove } from '@/lib/client/storage';
import styles from './harness.module.css';
import { SAMPLES } from './samples';

const DEFAULT_GEOMETRY = computeGeometry({ w: 390, h: 844 });

interface Params {
  sample: string;
  revealed: boolean;
  auto: boolean;
  expand: string[];
  panel: boolean;
}

function readParams(): Params {
  const q = new URLSearchParams(window.location.search);
  if (q.get('resetHint') === '1') safeRemove('local', STORAGE_KEYS.hintSeen);
  const sample = q.get('sample') ?? 'short';
  return {
    sample: sample in SAMPLES ? sample : 'short',
    revealed: q.get('revealed') !== '0',
    auto: q.get('auto') === '1',
    expand: (q.get('expand') ?? '').split(',').filter(Boolean),
    panel: q.get('panel') !== '0',
  };
}

export function AnswerHarness() {
  const [geo, setGeo] = useState<BookGeometry>(DEFAULT_GEOMETRY);
  const [params, setParams] = useState<Params | null>(null);
  const [online, setOnline] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const ref = useRef<PageContentHandle>(null);

  const note = useCallback((s: string) => setLog((l) => [...l.slice(-4), s]), []);

  useEffect(() => {
    setParams(readParams());
    const measure = () => setGeo(computeGeometry({ w: window.innerWidth, h: window.innerHeight }));
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  // 挂载后：自动显现、展开指定选项（供截图）
  const mountKey = params ? `${params.sample}-${params.revealed}-${geo.mode}` : '';
  useEffect(() => {
    if (!params || !mountKey) return;
    let cancelled = false;
    const run = async () => {
      if (params.auto) await ref.current?.reveal();
      if (cancelled) return;
      for (const letter of params.expand) {
        const btn = Array.from(document.querySelectorAll<HTMLButtonElement>('button[aria-expanded]')).find(
          (b) => b.getAttribute('aria-label')?.startsWith(`${letter}，`),
        );
        btn?.click();
      }
    };
    // 供 Playwright 直接调用句柄
    (window as unknown as { __answer?: PageContentHandle | null }).__answer = ref.current;
    const t = setTimeout(run, 50);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [mountKey, params]);

  if (!params) return <div className={styles.stage} />;
  const picked = SAMPLES[params.sample] ?? SAMPLES.short!;
  // ?rid=：带图样例改用真实答案的 id 取图
  const rid = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('rid') : null;
  const sample =
    rid && picked.model.kind === 'answer' && picked.model.reading.image
      ? { ...picked, model: { ...picked.model, reading: { ...picked.model.reading, id: rid } } }
      : picked;
  const { open, page, mode } = geo;
  const compact = mode === 'spread' && typeof window !== 'undefined' && window.innerHeight < 480;

  const set = (patch: Partial<Params>) => setParams({ ...params, ...patch });

  return (
    <div className={styles.stage}>
      <div className={styles.shell} style={{ left: open.x, top: open.y, width: open.w, height: open.h }}>
        {mode === 'spread' ? (
          <>
            <div className={`${styles.paper} ${styles.left}`} style={{ left: 0, width: page.w }} />
            <div className={`${styles.paper} ${styles.right}`} style={{ left: page.w, width: page.w }} />
          </>
        ) : (
          <div className={`${styles.paper} ${styles.right}`} style={{ left: 0, width: page.w }} />
        )}
        <div className={styles.content}>
          <PageContent
            key={mountKey}
            ref={ref}
            model={sample.model}
            mode={mode}
            compact={compact}
            initiallyRevealed={params.revealed}
            online={online}
            onAction={(a) => note(`onAction(${a})`)}
            onActionsCue={() => note('onActionsCue')}
          />
        </div>
      </div>

      {params.panel ? (
        <aside className={styles.panel}>
          <select value={params.sample} onChange={(e) => set({ sample: e.target.value })}>
            {Object.entries(SAMPLES).map(([k, v]) => (
              <option key={k} value={k}>
                {v.label}
              </option>
            ))}
          </select>
          <label>
            <input
              type="checkbox"
              checked={params.revealed}
              onChange={(e) => set({ revealed: e.target.checked })}
            />{' '}
            initiallyRevealed
          </label>
          <label>
            <input type="checkbox" checked={online} onChange={(e) => setOnline(e.target.checked)} /> online
          </label>
          <div className={styles.row}>
            <button type="button" onClick={() => ref.current?.reveal().then(() => note('reveal resolved'))}>
              reveal
            </button>
            <button type="button" onClick={() => ref.current?.skip()}>
              skip
            </button>
            <button
              type="button"
              onClick={() => ref.current?.dissolve().then(() => note('dissolve resolved'))}
            >
              dissolve
            </button>
            <button type="button" onClick={() => ref.current?.focusHeading()}>
              focus
            </button>
            <button type="button" onClick={() => safeRemove('local', STORAGE_KEYS.hintSeen)}>
              reset hint
            </button>
          </div>
          <div className={styles.meta}>
            {mode} · page {page.w}×{page.h}
            {compact ? ' · compact' : ''}
          </div>
          <ol className={styles.log}>
            {log.map((l, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: 开发日志
              <li key={i}>{l}</li>
            ))}
          </ol>
        </aside>
      ) : null}
    </div>
  );
}
