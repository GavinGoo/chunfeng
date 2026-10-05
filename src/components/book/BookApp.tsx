'use client';

// 前端唯一的编排者（07 §1）：状态机 + 几何 + 请求 + URL。`/` 与 `/a/[id]` 都只渲染 <BookApp initial={…} />。

import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { type CSSProperties, useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { AmbientBackground, usePrefersReducedMotion } from '@/components/ambient/AmbientBackground';
import { parseOverride, preloadFlipEngine } from '@/components/flip/select';
import type { FlipEngineKind } from '@/components/flip/types';
import { LiveRegion, type LiveRegionHandle } from '@/components/ui/LiveRegion';
import { zh } from '@/copy/zh';
import { usePerfTier } from '@/lib/client/perfTier';
import { isMine } from '@/lib/client/storage';
import { ActionBar, type ActionBarView } from './ActionBar';
import { BookShell } from './BookShell';
import { BookStage } from './BookStage';
import styles from './BookStage.module.css';
import { Cover, type CoverHandle, type CoverState } from './Cover';
import { type PageAction, PageContent, type PageContentHandle, ShareSheet } from './deps';
import { Lumen } from './Lumen';
import { bookReducer, type InitialBook, initialState, isAmbientActive, lumenPhase } from './machine';
import { toPageModel } from './outcome';
import { PageBase } from './PageBase';
import { RepoLink } from './RepoLink';
import { useBookEffects } from './useBookEffects';
import { geometryVars, useBookGeometry } from './useBookGeometry';
import { useImageAttachment } from './useImageAttachment';

export type { InitialBook };

// 查看大图：懒加载（15 §11.4）
const ImageViewer = dynamic(() => import('@/components/ui/ImageViewer'), { ssr: false });

export interface BookAppProps {
  initial: InitialBook;
  /** 图片提问（15 §4）：服务端按运行时的 LLM_VISION 决定，SSR 首屏就决定是否渲染附图入口 */
  visionEnabled?: boolean;
}

function useOnline(): boolean {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine !== false);
    update();
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
  return online;
}

export function BookApp({ initial, visionEnabled = false }: BookAppProps) {
  const [state, dispatch] = useReducer(bookReducer, initial, initialState);
  const probeRef = useRef<HTMLDivElement>(null);
  const geometry = useBookGeometry(probeRef);
  const online = useOnline();
  const reducedMotion = usePrefersReducedMotion();
  const perfTier = usePerfTier();

  const coverRef = useRef<CoverHandle>(null);
  const contentRef = useRef<PageContentHandle>(null);
  const bookRef = useRef<HTMLDivElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const liveRef = useRef<LiveRegionHandle>(null);
  const shareBtnRef = useRef<HTMLButtonElement>(null);

  const [question, setQuestion] = useState('');
  const [mounted, setMounted] = useState(false);
  const [flipOverride, setFlipOverride] = useState<FlipEngineKind | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [actionsCue, setActionsCue] = useState(-1);
  /** 服务端返回 VISION_DISABLED 后，本次会话隐藏附图入口（15 §10.8） */
  const [visionHidden, setVisionHidden] = useState(false);
  const vision = visionEnabled && !visionHidden;
  const [coverImageHint, setCoverImageHint] = useState<string | undefined>(undefined);
  const [previewOpen, setPreviewOpen] = useState(false);
  const previewReturnRef = useRef<HTMLElement | null>(null);

  const announce = useCallback((m: string) => liveRef.current?.announce(m), []);
  const attachment = useImageAttachment({
    enabled: vision,
    announce,
    onDisabled: () => setVisionHidden(true),
  });
  const clearAttachment = attachment.clear;

  const router = useRouter();
  const fx = useBookEffects({
    state,
    dispatch,
    geometry,
    refs: { cover: coverRef, content: contentRef, book: bookRef, layer: layerRef, live: liveRef },
    flipOverride,
    setQuestion,
    onAnswered: clearAttachment,
    navigateHome: initial.kind === 'notFound' ? () => router.push('/') : undefined,
  });

  // 挂载后：?flip= 透传、主人 / 访客（chunfeng:mine）
  // biome-ignore lint/correctness/useExhaustiveDependencies: 只在挂载时执行
  useEffect(() => {
    setFlipOverride(parseOverride(location.search));
    const c = state.content;
    if (c?.kind === 'ok') dispatch({ type: 'OWNER', owner: isMine(c.reading.id) });
    setMounted(true);
  }, []);

  // 有提问意图时预加载翻页引擎（three.js chunk 与纸页纹理，16 §3.10）：首次在铭牌中输入、开始输入法组字、
  // 指针按在书上，或铭牌里已有文字（草稿、合书预填）。只看不问的访客不下载 three.js
  const preloaded = useRef(false);
  const hasQuestion = question.trim() !== '';
  useEffect(() => {
    const book = bookRef.current;
    if (!geometry || !book || preloaded.current || state.phase !== 'closed') return;
    const preload = () => {
      if (preloaded.current) return;
      preloaded.current = true;
      preloadFlipEngine(geometry);
    };
    if (hasQuestion) {
      preload();
      return;
    }
    const events = ['input', 'compositionstart', 'pointerdown'] as const;
    for (const type of events) book.addEventListener(type, preload, { capture: true, passive: true });
    return () => {
      for (const type of events) book.removeEventListener(type, preload, { capture: true });
    };
  }, [geometry, state.phase, hasQuestion]);

  const { phase, content } = state;

  // 合书回到封面：图片失效或图片功能关闭 → 清除附图（后者隐藏入口）
  useEffect(() => {
    if (phase !== 'closed') return;
    if (state.hint === 'imageExpired' || state.hint === 'visionDisabled') clearAttachment();
    if (state.hint === 'visionDisabled') setVisionHidden(true);
  }, [phase, state.hint, clearAttachment]);

  // 附图状态一变，「图片还没附上」的提示就作废
  // biome-ignore lint/correctness/useExhaustiveDependencies: 只响应附图状态的变化
  useEffect(() => setCoverImageHint(undefined), [attachment.view.status]);

  /** 提交：图片还在上传时等它结束；失败则不提交（15 §10.7） */
  const onSubmit = (q: string) => {
    setCoverImageHint(undefined);
    void fx.submit(q, async () => {
      if (!vision) return {};
      const r = await attachment.settled();
      if (r.kind === 'failed') {
        setCoverImageHint(zh.cover.image.notReady);
        return null;
      }
      return r.kind === 'ready' ? { imageId: r.imageId } : {};
    });
  };
  const mode = geometry?.mode ?? null;

  // ---------- 派生视图 ----------

  const coverState: CoverState =
    phase === 'closed' ? (fx.submitting ? 'submitted' : 'idle') : fx.coverHidden ? 'hidden' : 'submitted';

  const answer = content?.kind === 'ok' ? content : null;
  let view: ActionBarView = { kind: 'none' };
  if ((phase === 'flipping' || phase === 'settling' || phase === 'opening') && fx.flipSince !== null) {
    const withImage = state.source?.kind === 'create' && !!state.source.hasImage;
    view = { kind: 'flipping', since: fx.flipSince, canClose: phase !== 'settling', withImage };
  } else if (
    answer &&
    mounted &&
    (phase === 'open' || phase === 'dissolving' || (phase === 'revealing' && actionsCue === state.contentRun))
  ) {
    view = answer.owner
      ? { kind: 'owner', pending: phase !== 'open' }
      : phase === 'open'
        ? { kind: 'visitor' }
        : view;
  }

  const bookRect = geometry ? (fx.posture === 'open' ? geometry.open : geometry.closed) : undefined;
  const vars = (geometry ? geometryVars(geometry) : {}) as CSSProperties;
  const compact = geometry ? geometry.vh < 480 : false;
  const hint =
    phase !== 'closed'
      ? undefined
      : state.hint === 'badRequest'
        ? zh.cover.input.badRequest
        : state.hint === 'imageExpired'
          ? zh.cover.image.expired
          : state.hint === 'visionDisabled'
            ? zh.cover.image.disabled
            : coverImageHint;
  const retryAt = content?.kind === 'error' ? content.retryAt : undefined;

  const onAction = (a: PageAction) => {
    if (a === 'retry') fx.retry();
    else if (a === 'reask')
      fx.leaveToHome(content?.kind === 'notice' || content?.kind === 'error' ? content.question : undefined);
    else fx.leaveToHome();
  };

  const model = content ? toPageModel(content) : null;
  const contentProps = model
    ? {
        model,
        compact,
        onAction,
        retryAvailableAt: retryAt,
        online,
        onActionsCue: () => setActionsCue(state.contentRun),
      }
    : null;

  return (
    <div
      className={styles.app}
      style={vars}
      data-book-state={phase}
      data-book-mode={mode ?? undefined}
      data-owner={answer ? String(answer.owner) : undefined}
      data-ready={mounted || undefined}
    >
      <div ref={probeRef} className={styles.safeProbe} aria-hidden="true" />
      <AmbientBackground
        intensity={isAmbientActive(phase) ? 'active' : 'calm'}
        bookRect={bookRect}
        settled={phase === 'closed' || phase === 'open'}
      />

      <BookStage
        posture={fx.posture}
        bookRef={bookRef}
        layerRef={layerRef}
        overlay={
          // 减少动态效果（含 ?flip=reduced）与品质档位 lite（16 §3.12）不渲染光幕（09 §5.1）
          reducedMotion || flipOverride === 'reduced' || perfTier === 'lite' ? null : (
            <Lumen
              lumen={lumenPhase(state)}
              cut={phase === 'closing' || phase === 'dissolving'}
              mode={mode}
            />
          )
        }
      >
        <BookShell mode={mode} showLeft={fx.posture === 'open'} />
        <PageBase side="right" />
        <div className={styles.coverBox}>
          <Cover
            ref={coverRef}
            value={question}
            onChange={setQuestion}
            onSubmit={onSubmit}
            state={coverState}
            mode={mode ?? 'single'}
            prefill={state.prefill}
            hint={hint}
            entrance={initial.kind === 'closed'}
            showPageEdges={false}
            visionEnabled={vision}
            attachment={attachment.view}
            onAttach={attachment.attach}
            onRemoveImage={attachment.remove}
            onRetryImage={attachment.retry}
            onPreviewImage={() => {
              previewReturnRef.current = coverRef.current?.attachTarget() ?? null;
              setPreviewOpen(true);
            }}
          />
        </div>
        {mode !== 'single' ? (
          <div className={mode ? undefined : styles.autoSpread}>
            <PageBase side="left" visible={fx.coverHidden} />
          </div>
        ) : null}
        {contentProps ? (
          <div
            className={styles.content}
            data-mode={mode ?? 'auto'}
            inert={phase !== 'open'}
            data-testid="page-content"
          >
            {mode ? (
              <PageContent
                key={state.contentRun}
                ref={contentRef}
                mode={mode}
                initiallyRevealed={state.contentRun === 0}
                {...contentProps}
              />
            ) : (
              <>
                <div className={styles.onlySingle}>
                  <PageContent mode="single" initiallyRevealed {...contentProps} />
                </div>
                <div className={styles.onlySpread}>
                  <PageContent mode="spread" initiallyRevealed {...contentProps} />
                </div>
              </>
            )}
          </div>
        ) : null}
      </BookStage>

      <ActionBar
        view={view}
        onClose={() => fx.leaveToHome()}
        onRegenerate={fx.regenerate}
        onShare={() => setShareOpen(true)}
        onChangeQuestion={() => fx.leaveToHome()}
        onAskToo={() => fx.leaveToHome()}
        shareRef={shareBtnRef}
      />

      <RepoLink />

      {answer ? (
        <ShareSheet
          open={shareOpen && phase === 'open'}
          readingId={answer.reading.id}
          question={answer.reading.question}
          onClose={() => setShareOpen(false)}
          returnFocusTo={shareBtnRef}
          hasPhoto={!!answer.reading.image}
        />
      ) : null}

      {attachment.view.previewUrl ? (
        <ImageViewer
          open={previewOpen && phase === 'closed'}
          src={attachment.view.previewUrl}
          alt={zh.answer.photoAltFallback}
          onClose={() => setPreviewOpen(false)}
          returnFocusTo={previewReturnRef}
        />
      ) : null}

      <LiveRegion ref={liveRef} />
    </div>
  );
}
