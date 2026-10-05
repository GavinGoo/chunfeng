'use client';

/**
 * 书的副作用（07 §4、§6；08 §4–§6；09 §5；11 §5）：根据状态机的状态驱动封面、书的平移、翻页引擎、
 * 请求、答案显现、URL 与播报。每个异步续体都带着自己的 run，run 变化（合上、再翻一次……）后不再生效。
 *
 * 时间线（提问）：
 *   提交 → 等可视视口稳定 → SUBMIT → opening：封面打开 ∥ 书平移到书脊居中 ∥ createReading ∥ 引擎挂载
 *   → 封面转过约 150° 时 engine.startLoop() → COVER_OPENED → flipping（提示轮换）
 *   → RESULT → settling：await engine.stop({ minLoopMs: 2400, minPages: 3 })（空白底页完全可见）
 *   → 隐藏封面、露出 DOM 纸页（均在画布之下）→ SETTLED → revealing：fadeOut(150) → pageContent.reveal()
 *   → REVEALED → open：焦点移到提问标题，LiveRegion 播报；释放翻页引擎（16 §3.2），再翻一次时在 dissolving 开始时重建
 */

import { type Dispatch, type RefObject, useCallback, useEffect, useRef, useState } from 'react';
import { selectEngine } from '@/components/flip/select';
import type { FlipEngine, FlipEngineKind } from '@/components/flip/types';
import type { LiveRegionHandle } from '@/components/ui/LiveRegion';
import { formatLiveError, formatLiveNotice, formatPageTitle, zh } from '@/copy/zh';
import { createReading } from '@/lib/client/createReading';
import { getReading } from '@/lib/client/getReading';
import { applyPendingPerfTier } from '@/lib/client/perfTier';
import { addMine, isMine } from '@/lib/client/storage';
import { randomUUID } from '@/lib/client/uuid';
import { waitViewportSettled } from '@/lib/client/viewport';
import { isReadingId } from '@/lib/shared/ids';
import type { CoverHandle } from './Cover';
import { COVER_DURATION_MS, cubicBezier, EASE_PAGE, EASE_PAGE_CSS, timeForProgress } from './CoverMotion';
import type { PageContentHandle } from './deps';
import type { BookEvent, BookState, Outcome } from './machine';
import { errorTitle } from './outcome';
import { closedTransform, type StageGeometry } from './useBookGeometry';

/** 封面转过约 150° 时起翻第一页（09 §5）：按 --ease-page 反解出的时间 */
export const LOOP_START_MS = Math.round(
  timeForProgress(cubicBezier(...EASE_PAGE), 150 / 180) * COVER_DURATION_MS,
);
export const MIN_LOOP_MS = 2400;
export const MIN_PAGES = 3;
const FADE_OUT_MS = 150;

export type Posture = 'closed' | 'open';

export interface BookRefs {
  cover: RefObject<CoverHandle | null>;
  content: RefObject<PageContentHandle | null>;
  book: RefObject<HTMLDivElement | null>;
  layer: RefObject<HTMLDivElement | null>;
  live: RefObject<LiveRegionHandle | null>;
}

export interface UseBookEffectsArgs {
  state: BookState;
  dispatch: Dispatch<BookEvent>;
  geometry: StageGeometry | null;
  refs: BookRefs;
  flipOverride: FlipEngineKind | null;
  /** 合书后铭牌的内容（预填或清空） */
  setQuestion(value: string): void;
  /** 得到 ok 答案（显现开始时）：清除附图草稿（15 §10.8） */
  onAnswered?(): void;
  /**
   * 本书渲染在 not-found 边界内时：地址一变 Next 就会重置边界并重新挂载本组件，
   * 因此回到首页改用路由跳转（由调用方提供 router.push('/')）。
   */
  navigateHome?: () => void;
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function isDesktop(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(hover: hover) and (pointer: fine)').matches;
}

const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

export function readingPath(id: string): string {
  return `/a/${id}`;
}

/** 解析地址：'/' → 首页；'/a/:id' → 答案；其他 → null */
export function parseBookPath(pathname: string): { kind: 'home' } | { kind: 'reading'; id: string } | null {
  if (pathname === '/' || pathname === '') return { kind: 'home' };
  const m = /^\/a\/([^/]+)\/?$/.exec(pathname);
  if (m?.[1] && isReadingId(m[1])) return { kind: 'reading', id: m[1] };
  return null;
}

function isAlive(ref: { current: BookState }, run: number): boolean {
  return ref.current.run === run;
}

export function useBookEffects({
  state,
  dispatch,
  geometry,
  refs,
  flipOverride,
  setQuestion,
  onAnswered,
  navigateHome,
}: UseBookEffectsArgs) {
  const initialOpen = state.phase === 'open';
  const [coverHidden, setCoverHidden] = useState(initialOpen);
  const [posture, setPosture] = useState<Posture>(initialOpen ? 'open' : 'closed');
  const [flipSince, setFlipSince] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const stateRef = useRef(state);
  stateRef.current = state;
  const geometryRef = useRef(geometry);
  geometryRef.current = geometry;
  const setQuestionRef = useRef(setQuestion);
  setQuestionRef.current = setQuestion;
  const navigateHomeRef = useRef(navigateHome);
  navigateHomeRef.current = navigateHome;
  const onAnsweredRef = useRef(onAnswered);
  onAnsweredRef.current = onAnswered;

  const engineRef = useRef<FlipEngine | null>(null);
  const enginePromise = useRef<Promise<FlipEngine | null> | null>(null);
  const loopRun = useRef(-1);
  const engineVisible = useRef(false);
  /** 引擎的代数：释放后加一，释放前还在创建中的引擎创建完即销毁 */
  const engineGen = useRef(0);
  /** 画布最近一次淡出：释放等它播完，显现中途跳过时画布照常淡出 */
  const engineFade = useRef<Promise<void>>(Promise.resolve());
  const abortRef = useRef<AbortController | null>(null);

  // ---------- 引擎 ----------

  const ensureEngine = useCallback((): Promise<FlipEngine | null> => {
    if (!enginePromise.current) {
      const gen = engineGen.current;
      enginePromise.current = (async () => {
        const layer = refs.layer.current;
        const g = geometryRef.current;
        if (!layer || !g) return null;
        try {
          const e = await selectEngine({
            kind: flipOverride ?? undefined,
            onFallback: (reason, from, to) => {
              if (process.env.NODE_ENV !== 'production') console.info(`[flip] ${from} → ${to}: ${reason}`);
            },
          });
          await e.mount(layer, geometryRef.current ?? g);
          if (engineGen.current !== gen) {
            e.destroy();
            return null;
          }
          engineRef.current = e;
          layer.dataset.engine = e.kind;
          return e;
        } catch {
          return null;
        }
      })();
    }
    return enginePromise.current;
  }, [refs.layer, flipOverride]);

  /**
   * 用完即还（16 §3.2）：书静止（open / closed）时释放引擎，下次翻页再由 ensureEngine 创建。
   * 画布此时已淡出、渲染循环已停，释放没有可见变化；翻页途中不释放。
   */
  const releaseEngine = useCallback(() => {
    const e = engineRef.current;
    engineGen.current += 1;
    engineRef.current = null;
    enginePromise.current = null;
    loopRun.current = -1;
    engineVisible.current = false;
    const layer = refs.layer.current;
    if (layer) delete layer.dataset.engine;
    if (e) void engineFade.current.then(() => e.destroy());
  }, [refs.layer]);

  useEffect(() => {
    if (geometry) engineRef.current?.resize(geometry);
  }, [geometry]);

  useEffect(
    () => () => {
      abortRef.current?.abort();
      engineGen.current += 1;
      engineRef.current?.destroy();
      engineRef.current = null;
      enginePromise.current = null;
    },
    [],
  );

  const ensureLoop = useCallback(
    async (run: number): Promise<FlipEngine | null> => {
      const e = await ensureEngine();
      if (!e || !isAlive(stateRef, run)) return e;
      if (loopRun.current !== run) {
        loopRun.current = run;
        e.startLoop();
        engineVisible.current = true;
        setFlipSince(performance.now());
      }
      return e;
    },
    [ensureEngine],
  );

  // ---------- 书的平移（横屏：书脊从左缘移到中央；低矮视口：合上时放大） ----------

  const moveBook = useCallback(
    (to: Posture): Promise<void> => {
      const el = refs.book.current;
      const g = geometryRef.current;
      setPosture(to);
      if (!el || !g) return Promise.resolve();
      const t = closedTransform(g);
      if (t === 'none' || prefersReducedMotion()) return Promise.resolve();
      const frames =
        to === 'open' ? [{ transform: t }, { transform: 'none' }] : [{ transform: 'none' }, { transform: t }];
      const a = el.animate(frames, { duration: COVER_DURATION_MS, easing: EASE_PAGE_CSS });
      return a.finished.then(
        () => undefined,
        () => undefined,
      );
    },
    [refs.book],
  );

  // ---------- 请求 ----------

  const startRequest = useCallback(
    (s: BookState) => {
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      const run = s.run;
      const src = s.source;
      if (!src) return;
      const deliver = (outcome: Outcome) => {
        if (stateRef.current.run === run) dispatch({ type: 'RESULT', run, outcome });
      };
      if (src.kind === 'create') {
        const hasImage = src.hasImage || undefined;
        void createReading(src.question, {
          requestId: src.requestId,
          regenOf: src.regenOf,
          imageId: src.imageId,
          signal: ac.signal,
        }).then((res) => {
          if (res.ok) {
            const d = res.data;
            if (d.status === 'ok') {
              addMine(d.reading.id);
              deliver({ kind: 'ok', reading: d.reading, owner: true });
            } else {
              deliver({
                kind: 'notice',
                status: d.status,
                message: d.message,
                resources: d.status === 'sensitive' ? d.resources : undefined,
                question: src.question,
                hasImage,
              });
            }
          } else if (res.error.code !== 'ABORTED') {
            const ra = res.error.retryAfterMs;
            deliver({
              kind: 'error',
              error: res.error,
              question: src.question,
              retryAt: ra ? Date.now() + ra : undefined,
              hasImage,
            });
          }
        });
      } else {
        void getReading(src.id, { signal: ac.signal }).then((res) => {
          if (res.ok) deliver({ kind: 'ok', reading: res.reading, owner: isMine(res.reading.id) });
          else if (res.error.code === 'NOT_FOUND') deliver({ kind: 'notFound' });
          else if (res.error.code !== 'ABORTED') deliver({ kind: 'error', error: res.error, question: '' });
        });
      }
    },
    [dispatch],
  );

  // ---------- 状态 → 副作用 ----------

  // biome-ignore lint/correctness/useExhaustiveDependencies: 只在状态或操作（run）变化时触发
  useEffect(() => {
    const s = stateRef.current;
    const run = s.run;
    const live = (msg: string) => refs.live.current?.announce(msg);

    switch (s.phase) {
      case 'opening': {
        startRequest(s);
        void ensureEngine();
        if (s.flip === 'loop') {
          const delay = prefersReducedMotion() ? 0 : LOOP_START_MS;
          setTimeout(() => {
            const p = stateRef.current.phase;
            if (isAlive(stateRef, run) && (p === 'opening' || p === 'flipping' || p === 'settling'))
              void ensureLoop(run);
          }, delay);
        }
        const opened = refs.cover.current?.open() ?? Promise.resolve();
        void Promise.all([opened, moveBook('open')]).then(() => {
          if (isAlive(stateRef, run)) dispatch({ type: 'COVER_OPENED', run });
        });
        break;
      }

      case 'flipping':
        if (s.flip === 'loop') void ensureLoop(run);
        break;

      case 'settling':
        void (async () => {
          const e = await ensureEngine();
          if (!isAlive(stateRef, run)) return;
          if (e) {
            if (s.flip === 'loop') {
              await ensureLoop(run);
              await e.stop({ minLoopMs: MIN_LOOP_MS, minPages: MIN_PAGES });
            } else {
              engineVisible.current = true;
              await e.flipOnce();
            }
          }
          if (!isAlive(stateRef, run)) return;
          // 画布此时铺满空白纸页：在它之下换掉封面（双页时封面背面在左页），露出 DOM 纸页
          setCoverHidden(true);
          dispatch({ type: 'SETTLED', run });
        })();
        break;

      case 'revealing':
        void (async () => {
          setFlipSince(null);
          const c = s.content;
          if (c?.kind === 'ok') {
            syncHistoryForAnswer(s, c.reading.id);
            // 问题已得到回答：清空铭牌（连同草稿与附图），合书后是一张新的铭牌
            setQuestionRef.current('');
            if (s.source?.kind === 'create') onAnsweredRef.current?.();
            document.title = formatPageTitle(c.reading.question);
          }
          await nextFrame();
          const e = engineRef.current;
          if (e && engineVisible.current) {
            engineVisible.current = false;
            engineFade.current = e.fadeOut(FADE_OUT_MS);
            await engineFade.current;
          }
          if (!isAlive(stateRef, run)) return;
          await refs.content.current?.reveal();
          if (isAlive(stateRef, run) && stateRef.current.phase === 'revealing')
            dispatch({ type: 'REVEALED', run });
        })();
        break;

      case 'open': {
        releaseEngine();
        applyPendingPerfTier(); // 运行时降档在书静止时生效（16 §3.12）
        if (run === 0) break; // 服务端渲染的初始内容：不抢焦点、不播报
        refs.content.current?.focusHeading();
        const c = s.content;
        if (c?.kind === 'ok') live(zh.live.revealed);
        else if (c?.kind === 'notice') live(formatLiveNotice(zh.notice[c.status].title));
        else if (c?.kind === 'error') live(formatLiveError(errorTitle(c.error)));
        else if (c?.kind === 'notFound') live(formatLiveNotice(zh.notFound.title));
        break;
      }

      case 'dissolving':
        startRequest(s);
        // 引擎在落页后已释放：与墨迹淡去（约 500 ms）并行重建
        void ensureEngine();
        void (async () => {
          await refs.content.current?.dissolve();
          if (isAlive(stateRef, run)) dispatch({ type: 'DISSOLVED', run });
        })();
        break;

      case 'closing':
        abortRef.current?.abort();
        setFlipSince(null);
        void (async () => {
          const e = engineRef.current;
          let fading: Promise<void> = Promise.resolve();
          if (e && engineVisible.current) {
            engineVisible.current = false;
            fading = e.fadeOut(FADE_OUT_MS);
            engineFade.current = fading;
          }
          if (s.content) await refs.content.current?.dissolve();
          await fading;
          if (!isAlive(stateRef, run)) return;
          setCoverHidden(false);
          await nextFrame();
          if (!isAlive(stateRef, run)) return;
          const closed = refs.cover.current?.close() ?? Promise.resolve();
          await Promise.all([closed, moveBook('closed')]);
          if (isAlive(stateRef, run)) dispatch({ type: 'CLOSED', run });
        })();
        break;

      case 'closed':
        releaseEngine();
        applyPendingPerfTier();
        if (run === 0) break;
        setQuestionRef.current(s.prefill ?? '');
        document.title = formatPageTitle();
        live(zh.live.closed);
        if (s.prefill === undefined && isDesktop())
          requestAnimationFrame(() => refs.cover.current?.focusInput());
        break;
    }
  }, [state.phase, state.run]);

  // ---------- 浏览器前进 / 后退（07 §6） ----------

  useEffect(() => {
    const onPop = () => {
      const target = parseBookPath(location.pathname);
      if (target) dispatch({ type: 'POP', target });
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [dispatch]);

  // ---------- 显现中点击或按键：跳到最终状态（11 §5） ----------

  useEffect(() => {
    if (state.phase !== 'revealing') return;
    const skip = () => {
      refs.content.current?.skip();
      dispatch({ type: 'SKIP' });
    };
    window.addEventListener('pointerdown', skip);
    window.addEventListener('keydown', skip);
    return () => {
      window.removeEventListener('pointerdown', skip);
      window.removeEventListener('keydown', skip);
    };
  }, [state.phase, dispatch, refs.content]);

  // ---------- 用户操作 ----------

  /**
   * 提交。prepare：提交前的准备（等附图上传结束，15 §10.7），返回 null 表示放弃提交；
   * 其间按钮保持按下态（submitting），重复点击不会重复提交。
   */
  const submitLock = useRef(false);
  const submit = useCallback(
    async (question: string, prepare?: () => Promise<{ imageId?: string } | null>) => {
      if (stateRef.current.phase !== 'closed' || submitLock.current) return;
      submitLock.current = true;
      setSubmitting(true);
      try {
        const prepared = prepare ? await prepare() : {};
        if (!prepared || stateRef.current.phase !== 'closed') return;
        await waitViewportSettled();
        dispatch({ type: 'SUBMIT', question, requestId: randomUUID(), imageId: prepared.imageId });
      } finally {
        submitLock.current = false;
        setSubmitting(false);
      }
    },
    [dispatch],
  );

  /** 回到封面：地址在 /a/:id 时按 07 §6 处理历史记录 */
  const leaveToHome = useCallback(
    (prefill?: string) => {
      const hard = navigateHomeRef.current;
      if (hard) {
        hard();
        return;
      }
      if (location.pathname !== '/') {
        const st = history.state as { cf?: number } | null;
        if (st?.cf === 1 && prefill === undefined) {
          history.back(); // popstate → POP(home) → closing
          return;
        }
        history.pushState(null, '', '/');
      }
      dispatch({ type: 'CLOSE', prefill });
    },
    [dispatch],
  );

  const regenerate = useCallback(() => dispatch({ type: 'REGENERATE', requestId: randomUUID() }), [dispatch]);
  const retry = useCallback(() => dispatch({ type: 'RETRY' }), [dispatch]);

  return {
    coverHidden,
    posture,
    flipSince,
    submitting,
    submit,
    leaveToHome,
    regenerate,
    retry,
    ensureEngine,
  };
}

/** 得到 ok 答案时同步地址：首次 pushState，再翻一次（或已在答案页）replaceState；已是该地址则不动 */
function syncHistoryForAnswer(s: BookState, id: string): void {
  if (s.source?.kind !== 'create') return;
  const path = readingPath(id);
  if (location.pathname === path) return;
  const st = history.state as { cf?: number } | null;
  if (s.source.regenOf || location.pathname.startsWith('/a/')) {
    // 保留原有的 cf 标记：从扫码直达的答案页再翻一次时，「换个问题」不能 back 出本站
    history.replaceState(st?.cf === 1 ? { cf: 1 } : null, '', path);
  } else {
    history.pushState({ cf: 1 }, '', path);
  }
}
