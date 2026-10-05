'use client';

/**
 * 封面（08）：午夜蓝皮革 + 烫金双线框（与主副标题一起做微凸的浮雕）+ 左上、右下一对祥云角花；左上角主副标题，正中题字线，其下「翻开属于你的那页」，
 * 右下角压纹风纹；左侧书脊压线，右侧与底部露出 6 px 页块边缘；背面为环衬。
 *
 * 尺寸：封面填满父元素（舞台负责定位与宽高，比例 0.68）；页块边缘与书的投影画在父元素盒子之外（右、下各约 7 px）。
 * 文字随封面宽度缩放（容器查询单位 cqw）。3D：根节点 transform-style: preserve-3d，
 * perspective 由舞台根节点提供（须等于 geometry.perspective，08 §6）。
 *
 * 接口：
 *   <Cover
 *     value? onChange?          // 受控；不传则内部管理（仍会读写草稿）
 *     onSubmit={(question) => …} // 问题已规范化、长度 ≥ 2；调用前已 blur 收起键盘。requestId 与视口稳定等待由舞台负责（08 §4）
 *     state="idle" | "submitted" | "hidden"
 *                               // submitted：铭牌只读，铭牌与按钮 200 ms 淡出，按钮保持按下态；hidden：封面不可见且 inert
 *     mode="single" | "spread"  // 决定 open() 的表现
 *     prefill?                  // 变化时写入铭牌，并把光标放到末尾（仅桌面端聚焦）
 *     hint?                     // 铭牌下方的常驻提示（如 BAD_REQUEST 回到封面后的提示）
 *     entrance?                 // 首次进场：自下方 12 px 淡入上移（默认 true）
 *     showPageEdges?            // 是否绘制页块边缘与投影（默认 true；舞台自带书壳时可关闭）
 *     visionEnabled?            // 图片提问（15 §10）：点进输入框后在题字线左侧出现附图按钮
 *     attachment? onAttach? onRemoveImage? onRetryImage? onPreviewImage?
 *     ref={coverRef}            // CoverHandle
 *   />
 *   coverRef.current.open()  → Promise<void>：沿书脊 rotateY(0 → -180deg)，1100 ms，--ease-page；
 *                              single 模式在 100°–160° 间淡出；减少动态效果时改为 200 ms 淡化。
 *   coverRef.current.close() → Promise<void>：反向旋回。
 *   coverRef.current.focusInput()：聚焦铭牌并把光标放到末尾。
 */

import {
  type DragEvent,
  type FormEvent,
  type Ref,
  useEffect,
  useId,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import { formatImageFailedHint, formatPasteTruncated, zh } from '@/copy/zh';
import { graphemeLength, normalizeQuestion, QUESTION_MAX, QUESTION_MIN } from '@/lib/shared/question';
import { AttachSlot } from './AttachSlot';
import styles from './Cover.module.css';
import { CloudCorner, WindMark } from './CoverArt';
import { FOIL_RELIEF_FILTER, FoilReliefDefs, FoilText } from './CoverFoil';
import { COVER_DURATION_MS, COVER_REDUCED_MS, coverKeyframes, EASE_PAGE_CSS } from './CoverMotion';
import { OpenButton } from './OpenButton';
import { QuestionPlate } from './QuestionPlate';
import type { AttachmentView } from './useImageAttachment';

export type CoverState = 'idle' | 'submitted' | 'hidden';
export type CoverMode = 'single' | 'spread';

export interface CoverHandle {
  open(): Promise<void>;
  close(): Promise<void>;
  focusInput(): void;
  /** 附图按钮或缩略图（删除后焦点移到附图按钮；预览关闭后焦点回到缩略图） */
  attachTarget(): HTMLElement | null;
}

export interface CoverProps {
  value?: string;
  onChange?(value: string): void;
  onSubmit(question: string): void;
  state?: CoverState;
  mode?: CoverMode;
  prefill?: string;
  hint?: string;
  entrance?: boolean;
  showPageEdges?: boolean;
  className?: string;
  /** 图片提问（15 §10）；不传时封面与现状完全一致 */
  visionEnabled?: boolean;
  attachment?: AttachmentView;
  onAttach?(file: File): void;
  onRemoveImage?(): void;
  onRetryImage?(): void;
  onPreviewImage?(): void;
  ref?: Ref<CoverHandle>;
}

const NO_ATTACHMENT: AttachmentView = { status: 'none' };

const GUIDE_MS = 2000;
const TRUNCATE_HINT_MS = 2400;

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function isDesktop(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(hover: hover) and (pointer: fine)').matches;
}

export function Cover({
  value: controlled,
  onChange,
  onSubmit,
  state = 'idle',
  mode = 'single',
  prefill,
  hint,
  entrance = true,
  showPageEdges = true,
  className,
  visionEnabled = false,
  attachment = NO_ATTACHMENT,
  onAttach,
  onRemoveImage,
  onRetryImage,
  onPreviewImage,
  ref,
}: CoverProps) {
  const [own, setOwn] = useState('');
  const value = controlled ?? own;
  const setValue = (next: string) => {
    if (controlled === undefined) setOwn(next);
    onChange?.(next);
  };

  const boardRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const animations = useRef<Animation[]>([]);
  const [flashKey, setFlashKey] = useState(0);
  const [transient, setTransient] = useState<{ text: string; key: number } | null>(null);
  const hintId = useId();
  const attachBtnRef = useRef<HTMLButtonElement>(null);
  const thumbRef = useRef<HTMLButtonElement>(null);
  /** 附图槽位：与占位符的「点进」同源，点进时出现、焦点离开铭牌时随打字机重新开始而隐藏（15 §10.2） */
  const [slotEngaged, setSlotEngaged] = useState(false);
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);

  const ready = graphemeLength(normalizeQuestion(value)) >= QUESTION_MIN;

  const focusInput = () => {
    const el = inputRef.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    const end = el.value.length;
    el.setSelectionRange(end, end);
  };

  // 临时提示：到时淡出
  useEffect(() => {
    if (!transient) return;
    const ms = transient.text === zh.cover.emptyGuide ? GUIDE_MS : TRUNCATE_HINT_MS;
    const t = setTimeout(() => setTransient(null), ms);
    return () => clearTimeout(t);
  }, [transient]);

  // 预填（「重新提问」合书后）；铭牌有字时附图槽位一直显示（15 §10.2）
  // biome-ignore lint/correctness/useExhaustiveDependencies: 只响应 prefill 的变化
  useEffect(() => {
    if (prefill === undefined) return;
    setValue(prefill);
    if (isDesktop()) requestAnimationFrame(focusInput);
  }, [prefill]);

  // 提交后槽位随铭牌淡出；下次合书回到封面时恢复为「未点进」
  useEffect(() => {
    if (state !== 'idle') {
      setSlotEngaged(false);
      setDragging(false);
      dragDepth.current = 0;
    }
  }, [state]);

  const run = async (opening: boolean): Promise<void> => {
    const board = boardRef.current;
    if (!board) return;
    for (const a of animations.current) a.cancel();
    const reduced = prefersReducedMotion();
    let list: Animation[];
    if (reduced) {
      // 减少动态效果：不旋转，只做 200 ms 透明度淡化。
      // 单页打开：封面淡出；双页打开：封面直接落到左侧（背面朝上）后淡入；合上：封面在原位淡入
      const keyframes: Keyframe[] =
        opening && mode === 'single'
          ? [{ opacity: 1 }, { opacity: 0 }]
          : [
              { transform: opening ? 'rotateY(-180deg)' : 'rotateY(0deg)', opacity: 0 },
              { transform: opening ? 'rotateY(-180deg)' : 'rotateY(0deg)', opacity: 1 },
            ];
      list = [board.animate(keyframes, { duration: COVER_REDUCED_MS, easing: 'linear', fill: 'forwards' })];
    } else {
      const { rotate, fade } = coverKeyframes(mode, opening);
      list = [
        board.animate(rotate, { duration: COVER_DURATION_MS, easing: EASE_PAGE_CSS, fill: 'forwards' }),
      ];
      if (fade)
        list.push(board.animate(fade, { duration: COVER_DURATION_MS, easing: 'linear', fill: 'forwards' }));
    }
    animations.current = list;
    await Promise.all(list.map((a) => a.finished.catch(() => undefined)));
  };

  useImperativeHandle(ref, () => ({
    open: () => run(true),
    close: () => run(false),
    focusInput,
    attachTarget: () => thumbRef.current ?? attachBtnRef.current,
  }));

  const vision = visionEnabled && !!onAttach;
  const hasImage = attachment.status !== 'none';
  // 与占位符打字机互斥：打字机在播（铭牌为空且未点进）时不显示，已附图或拖入时除外
  const slotVisible = vision && state === 'idle' && (slotEngaged || value !== '' || hasImage || dragging);

  const attachFiles = (files: File[]) => {
    const images = files.filter((f) => f.type === '' || f.type.startsWith('image/'));
    const first = images[0] ?? files[0];
    if (!first || !onAttach) return;
    if (files.length > 1) setTransient({ text: zh.cover.image.onlyOne, key: Date.now() });
    onAttach(first);
  };

  // 拖入（精确指针设备）：拖着文件经过封面时题字线亮起、槽位出现，松手即附图（15 §10.4）
  const hasFiles = (e: DragEvent) => [...e.dataTransfer.types].includes('Files');
  const dragProps = vision
    ? {
        onDragEnter: (e: DragEvent) => {
          if (!hasFiles(e) || state !== 'idle') return;
          e.preventDefault();
          dragDepth.current++;
          setDragging(true);
        },
        onDragOver: (e: DragEvent) => {
          if (!hasFiles(e) || state !== 'idle') return;
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
        },
        onDragLeave: (e: DragEvent) => {
          if (!hasFiles(e)) return;
          dragDepth.current = Math.max(0, dragDepth.current - 1);
          if (dragDepth.current === 0) setDragging(false);
        },
        onDrop: (e: DragEvent) => {
          if (!hasFiles(e)) return;
          e.preventDefault();
          dragDepth.current = 0;
          setDragging(false);
          if (state === 'idle') attachFiles([...e.dataTransfer.files]);
        },
      }
    : {};

  const handleSubmit = (e?: FormEvent) => {
    e?.preventDefault();
    if (state !== 'idle') return;
    const question = normalizeQuestion(value);
    if (graphemeLength(question) < QUESTION_MIN) {
      // 温和的引导：铭牌边框亮起一次，下方淡入提示。不抖动、不弹窗；只附了图时引导写一句（Q10）
      setFlashKey((k) => k + 1);
      setTransient({ text: hasImage ? zh.cover.image.needText : zh.cover.emptyGuide, key: Date.now() });
      return;
    }
    inputRef.current?.blur(); // 收起移动端键盘
    onSubmit(question);
  };

  // 提示行的优先级：临时提示 > 拖入 > 舞台给出的提示 > 附图失败
  let imageHint = '';
  if (vision && state === 'idle') {
    if (dragging) imageHint = zh.cover.image.dropHere;
    else if (attachment.status === 'failed' && attachment.failReason)
      imageHint = formatImageFailedHint(attachment.failReason, attachment.retryAfterMs);
  }
  const hintText = transient?.text ?? (dragging ? imageHint : undefined) ?? hint ?? (imageHint || '');

  return (
    <div
      className={`${styles.cover} ${className ?? ''}`}
      data-state={state}
      data-entrance={entrance || undefined}
      data-edges={showPageEdges || undefined}
      data-dragging={dragging || undefined}
      {...dragProps}
    >
      <FoilReliefDefs />
      {showPageEdges ? (
        <div className={styles.body} aria-hidden="true">
          <span className={styles.edgeRight} />
          <span className={styles.edgeBottom} />
        </div>
      ) : null}

      <div ref={boardRef} className={styles.board}>
        <section className={styles.front} aria-label={zh.cover.label} inert={state === 'hidden'}>
          <div className={styles.face}>
            <div className={styles.frame} style={{ filter: FOIL_RELIEF_FILTER }} aria-hidden="true">
              <CloudCorner className={`${styles.corner} ${styles.tl}`} />
              <CloudCorner className={`${styles.corner} ${styles.br}`} />
            </div>
            <WindMark className={styles.wind} />

            <div className={styles.content}>
              <header className={styles.titles}>
                <h1 className={styles.title}>
                  <FoilText sheen="loop" matte relief>
                    {zh.cover.title}
                  </FoilText>
                </h1>
                <p className={styles.subtitle}>
                  <FoilText relief>{zh.cover.subtitle}</FoilText>
                </p>
              </header>

              <form className={styles.form} onSubmit={handleSubmit} noValidate>
                <QuestionPlate
                  value={value}
                  onChange={setValue}
                  onEnter={() => handleSubmit()}
                  readOnly={state !== 'idle'}
                  flashKey={flashKey}
                  onTruncate={() =>
                    setTransient({ text: formatPasteTruncated(QUESTION_MAX), key: Date.now() })
                  }
                  describedBy={hintText ? hintId : undefined}
                  inputRef={inputRef}
                  vision={vision}
                  lit={dragging}
                  onEngagedChange={vision ? setSlotEngaged : undefined}
                  onPasteFiles={vision && state === 'idle' ? attachFiles : undefined}
                  slot={
                    vision ? (
                      <AttachSlot
                        attachment={attachment}
                        visible={slotVisible}
                        disabled={state !== 'idle'}
                        onPick={(f) => attachFiles([f])}
                        onRemove={() => {
                          onRemoveImage?.();
                          // 槽位保留为附图按钮，焦点随后移入（15 §10.3）
                          setSlotEngaged(true);
                          requestAnimationFrame(() => attachBtnRef.current?.focus({ preventScroll: true }));
                        }}
                        onRetry={() => onRetryImage?.()}
                        onPreview={() => onPreviewImage?.()}
                        onPicked={() => requestAnimationFrame(focusInput)}
                        buttonRef={attachBtnRef}
                        thumbRef={thumbRef}
                      />
                    ) : null
                  }
                />
                <p
                  id={hintId}
                  className={styles.hint}
                  aria-live="polite"
                  data-visible={hintText ? '' : undefined}
                >
                  {hintText}
                </p>
                <OpenButton ready={ready} held={state === 'submitted'} inert={state !== 'idle'} />
              </form>
            </div>
          </div>
        </section>

        <div className={styles.back} aria-hidden="true" />
      </div>
    </div>
  );
}
