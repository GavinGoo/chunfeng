'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { type BookGeometry, computeGeometry } from '@/components/book/geometry';
import { parseOverride, selectEngine } from '@/components/flip/select';
import type { FlipEngine, FlipEngineKind } from '@/components/flip/types';
import styles from './harness.module.css';

type Busy = 'idle' | 'looping' | 'settling' | 'once';

function viewportGeometry(): BookGeometry {
  return computeGeometry({ w: window.innerWidth, h: window.innerHeight });
}

export function FlipHarness() {
  const layerRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<FlipEngine | null>(null);
  const loopStartRef = useRef(0);
  const [geometry, setGeometry] = useState<BookGeometry | null>(null);
  const [kind, setKind] = useState<FlipEngineKind | null>(null);
  const [actual, setActual] = useState<string>('—');
  const [busy, setBusy] = useState<Busy>('idle');
  const [log, setLog] = useState<string>('');

  const note = useCallback((line: string) => {
    setLog((prev) => [line, ...prev.split('\n')].slice(0, 6).join('\n'));
  }, []);

  // 几何随视口变化（rAF 节流）
  useEffect(() => {
    setKind(parseOverride(location.search) ?? 'webgl');
    setGeometry(viewportGeometry());
    let raf = 0;
    const onResize = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setGeometry(viewportGeometry()));
    };
    window.addEventListener('resize', onResize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
    };
  }, []);

  const geometryRef = useRef<BookGeometry | null>(null);
  geometryRef.current = geometry;

  // 引擎生命周期：切换引擎时销毁重建
  useEffect(() => {
    const layer = layerRef.current;
    const g = geometryRef.current;
    if (!kind || !layer || !g) return;
    let disposed = false;
    let engine: FlipEngine | null = null;
    setActual('loading…');
    void (async () => {
      const t0 = performance.now();
      const e = await selectEngine({
        kind,
        onFallback: (reason, from, to) => note(`fallback ${from} → ${to}: ${reason}`),
      });
      if (disposed) return;
      engine = e;
      await e.mount(layer, geometryRef.current ?? g);
      if (disposed) {
        e.destroy();
        return;
      }
      engineRef.current = e;
      setActual(e.kind);
      note(`mounted ${e.kind} in ${Math.round(performance.now() - t0)} ms`);
    })();
    return () => {
      disposed = true;
      engine?.destroy();
      engineRef.current = null;
      setBusy('idle');
    };
  }, [kind, note]);

  useEffect(() => {
    if (geometry) engineRef.current?.resize(geometry);
  }, [geometry]);

  const start = useCallback(() => {
    const e = engineRef.current;
    if (!e) return;
    loopStartRef.current = performance.now();
    e.startLoop();
    setBusy('looping');
  }, []);

  const stop = useCallback(async () => {
    const e = engineRef.current;
    if (!e) return;
    setBusy('settling');
    const t = performance.now();
    await e.stop();
    note(
      `settled: stop→${Math.round(performance.now() - t)} ms, total ${Math.round(performance.now() - loopStartRef.current)} ms`,
    );
    await e.fadeOut(150);
    setBusy('idle');
  }, [note]);

  const resultAt = useCallback(
    (ms: number) => {
      start();
      setTimeout(() => void stop(), ms);
    },
    [start, stop],
  );

  const once = useCallback(async () => {
    const e = engineRef.current;
    if (!e) return;
    setBusy('once');
    const t = performance.now();
    await e.flipOnce();
    note(`flipOnce ${Math.round(performance.now() - t)} ms`);
    await e.fadeOut(150);
    setBusy('idle');
  }, [note]);

  const g = geometry;
  return (
    <div className={styles.stage} style={g ? { perspective: `${g.perspective}px` } : undefined}>
      {g && (
        <div
          className={styles.shell}
          data-testid="book-shell"
          style={{ left: g.open.x, top: g.open.y, width: g.open.w, height: g.open.h }}
        >
          {g.mode === 'spread' && (
            <div className={`${styles.page} ${styles.left}`} style={{ left: 0, width: g.page.w }} />
          )}
          <div
            className={`${styles.page} ${styles.right}`}
            style={{ left: g.mode === 'spread' ? g.page.w : 0, width: g.page.w }}
          />
        </div>
      )}
      <div ref={layerRef} className={styles.layer} data-testid="flip-layer" />

      <div className={styles.status}>
        {`engine ${actual} · ${g?.mode ?? ''} · page ${g ? `${g.page.w}×${g.page.h}` : ''} · ${busy}\n${log}`}
      </div>

      <div className={styles.bar}>
        <button type="button" onClick={start} disabled={busy !== 'idle'}>
          start loop
        </button>
        <button type="button" onClick={() => void stop()} disabled={busy !== 'looping'}>
          stop
        </button>
        <button type="button" onClick={() => resultAt(300)} disabled={busy !== 'idle'}>
          result @0.3s
        </button>
        <button type="button" onClick={() => resultAt(3000)} disabled={busy !== 'idle'}>
          result @3s
        </button>
        <button type="button" onClick={() => void once()} disabled={busy !== 'idle'}>
          flip once
        </button>
        {(['webgl', 'css', 'reduced'] as const).map((k) => (
          <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)}>
            {k}
          </button>
        ))}
      </div>
    </div>
  );
}
