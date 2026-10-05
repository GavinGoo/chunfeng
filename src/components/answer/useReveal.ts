'use client';

// 墨迹显现与淡去（11 §5）：按 reveal.ts 的时间表，用 WAAPI 在 DOM 上执行。
//
// DOM 约定（均在 PageContent 根节点之内）：
// - 根节点 `data-ink-state`：hidden（空白纸页）→ revealing → shown；dissolving → hidden
// - 叶子 `data-ink`：head | char | photo | corner | rule | ornament | item | fill | seal | hint
//   照片（15 §11.3）：photo 先现出（纱层 `data-photo-veil` 盖着，像空白相纸），纱层淡去即显影，随后相角淡入
//   hidden 状态下由 CSS 统一隐藏；revealing 时 CSS 放开，由 WAAPI（fill: backwards）在各自开始前保持隐藏
// - 百分比 `data-pct-target`（整数）与 `data-pct-final`（最终文本）：与填充条同步递增
// - 淡去的块 `data-ink-block`：按 DOM 顺序的反序淡出
// - 金尘层 `data-dust`（11 §5.1，只在答案页）：显现时从提问的字间升起零星金粉，结束或跳过时清空
// 品质档位 lite（16 §3.12）：提问逐字显现与淡去只做透明度，不模糊

import { type RefObject, useCallback, useEffect, useRef } from 'react';
import type { BookMode } from '@/components/book/geometry';
import { usePerfTier } from '@/lib/client/perfTier';
import {
  computeRevealPlan,
  countUpValue,
  type DustGrain,
  dissolveStagger,
  INK,
  seededRandom,
} from './reveal';

export type InkState = 'hidden' | 'revealing' | 'shown' | 'dissolving';

const EASE_SOFT = 'cubic-bezier(.2,.7,.2,1)';
const EASE_INK = 'cubic-bezier(.3,0,.2,1)';

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

function nextFrame(): Promise<void> {
  return new Promise((r) => requestAnimationFrame(() => r()));
}

const all = (root: HTMLElement, sel: string) => Array.from(root.querySelectorAll<HTMLElement>(sel));

/**
 * 金尘（11 §5.1）：每粒一个圆点节点，出生在所选字的包围盒内随机一点，顺着春风向右上飘散。
 * 只动 transform 与 opacity；节点在 delay 前由 fill: backwards 保持透明，动画结束即移除。
 */
function spawnDust(layer: HTMLElement, chars: HTMLElement[], grains: DustGrain[]): Animation[] {
  const origin = layer.getBoundingClientRect();
  const list: Animation[] = [];
  for (const g of grains) {
    const box = chars[g.charIndex]?.getBoundingClientRect();
    if (!box) continue;
    const rand = seededRandom(g.seed);
    const size = 1.5 + rand() * 1.5;
    const x = box.left - origin.left + rand() * box.width;
    const y = box.top - origin.top + rand() * box.height;
    const peak = 0.55 + rand() * 0.35;
    const dx = 10 + rand() * 22;
    const dy = -(16 + rand() * 28);
    const node = document.createElement('span');
    node.style.cssText = `left:${(x - size / 2).toFixed(1)}px;top:${(y - size / 2).toFixed(1)}px;width:${size.toFixed(2)}px;height:${size.toFixed(2)}px`;
    layer.append(node);
    const at = (f: number, scale: number, opacity: number): Keyframe => ({
      offset: f,
      opacity,
      transform: `translate(${(dx * f).toFixed(1)}px, ${(dy * f).toFixed(1)}px) scale(${scale})`,
    });
    // 前 25% 升到峰值，中途微闪一次（降到峰值的 60% 再回升），最后归零
    const anim = node.animate(
      [at(0, 1, 0), at(0.25, 0.875, peak), at(0.5, 0.75, peak * 0.6), at(0.7, 0.65, peak), at(1, 0.5, 0)],
      { delay: g.at, duration: g.dur, easing: EASE_SOFT, fill: 'backwards' },
    );
    anim.onfinish = () => node.remove();
    list.push(anim);
  }
  return list;
}

interface Options {
  mode: BookMode;
  /** ActionBar 应当淡入时（11 §5 最后一行；跳过时立即） */
  onActionsCue?: () => void;
}

export interface RevealControls {
  reveal(): Promise<void>;
  skip(): void;
  dissolve(): Promise<void>;
}

export function useReveal(
  rootRef: RefObject<HTMLElement | null>,
  { mode, onActionsCue }: Options,
): RevealControls {
  const anims = useRef<Animation[]>([]);
  const dustRef = useRef<{ layer: HTMLElement; anims: Animation[] } | null>(null);
  const finishRef = useRef<(() => void) | null>(null);
  const cueRef = useRef(onActionsCue);
  cueRef.current = onActionsCue;
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const tier = usePerfTier();
  const liteRef = useRef(tier === 'lite');
  liteRef.current = tier === 'lite';

  const setState = useCallback(
    (s: InkState) => {
      const root = rootRef.current;
      if (!root) return;
      root.dataset.inkState = s;
      root.inert = s === 'revealing' || s === 'dissolving';
    },
    [rootRef],
  );

  const cancelAll = useCallback(() => {
    for (const a of anims.current) a.cancel();
    anims.current = [];
  }, []);

  /** 立即移除全部金尘 */
  const clearDust = useCallback(() => {
    const d = dustRef.current;
    dustRef.current = null;
    if (!d) return;
    for (const a of d.anims) a.cancel();
    d.layer.replaceChildren();
  }, []);

  const skip = useCallback(() => {
    for (const a of anims.current) {
      try {
        a.finish();
      } catch {
        a.cancel();
      }
    }
    finishRef.current?.();
  }, []);

  const reveal = useCallback(async (): Promise<void> => {
    const root = rootRef.current;
    if (!root || root.dataset.inkState === 'shown' || root.dataset.inkState === 'revealing') return;
    cancelAll();
    // 等新内容提交到 DOM、完成布局
    await nextFrame();
    await nextFrame();
    const el = rootRef.current;
    if (!el) return;

    const reduced = prefersReducedMotion();
    const chars = all(el, '[data-ink="char"]');
    const items = all(el, '[data-ink="item"]');
    const fills = all(el, '[data-ink="fill"]');
    const seals = all(el, '[data-ink="seal"]');
    const hints = all(el, '[data-ink="hint"]');
    const pcts = all(el, '[data-pct-target]');
    const photos = all(el, '[data-ink="photo"]');
    const veils = all(el, '[data-photo-veil]');
    const corners = all(el, '[data-ink="corner"]');
    const dustLayer = reduced ? null : el.querySelector<HTMLElement>('[data-dust]');
    const plan = computeRevealPlan({
      chars: chars.length,
      items: items.length,
      hasFill: fills.length > 0,
      hasSeal: seals.length > 0,
      hasHint: hints.length > 0,
      hasPhoto: photos.length > 0,
      mode: modeRef.current,
      dustSeed: dustLayer ? Math.floor(Math.random() * 2 ** 32) : undefined,
    });

    const list: Animation[] = [];
    const run = (
      target: HTMLElement,
      frames: Keyframe[],
      delay: number,
      duration: number,
      easing: string,
    ) => {
      list.push(target.animate(frames, { delay, duration, easing, fill: 'backwards' }));
    };

    setState('revealing');
    let cueTimer: ReturnType<typeof setTimeout> | undefined;
    let cued = false;
    const cue = () => {
      if (cued) return;
      cued = true;
      clearTimeout(cueTimer);
      cueRef.current?.();
    };

    if (reduced) {
      // 减少动态效果：全部内容 200 ms 一起淡入
      run(el, [{ opacity: 0 }, { opacity: 1 }], 0, INK.reducedDur, 'linear');
      cueTimer = setTimeout(cue, 0);
    } else {
      const fadeIn: Keyframe[] = [{ opacity: 0 }, { opacity: 1 }];
      for (const h of all(el, '[data-ink="head"]')) run(h, fadeIn, plan.head.start, plan.head.dur, EASE_SOFT);
      const q = plan.question;
      chars.forEach((c, i) => {
        run(
          c,
          liteRef.current
            ? fadeIn
            : [
                { opacity: 0, filter: 'blur(3px)' },
                { opacity: 1, filter: 'blur(0px)' },
              ],
          q.start + i * q.stagger,
          q.charDur,
          EASE_INK,
        );
      });
      if (dustLayer && plan.dust.length > 0) {
        clearDust();
        dustRef.current = { layer: dustLayer, anims: spawnDust(dustLayer, chars, plan.dust) };
      }
      if (plan.photo) {
        const p = plan.photo;
        for (const ph of photos) run(ph, fadeIn, p.start, 120, 'linear');
        for (const v of veils) run(v, [{ opacity: 1 }, { opacity: 0 }], p.start, p.dur, EASE_INK);
      }
      if (plan.corners)
        for (const c of corners) run(c, fadeIn, plan.corners.start, plan.corners.dur, EASE_SOFT);
      for (const r of all(el, '[data-ink="rule"]')) {
        run(
          r,
          [
            { opacity: 0, transform: 'scaleX(0)' },
            { opacity: 1, transform: 'scaleX(1)' },
          ],
          plan.rule.start,
          plan.rule.dur,
          EASE_INK,
        );
      }
      for (const o of all(el, '[data-ink="ornament"]'))
        run(o, fadeIn, plan.rule.start, INK.ornamentDur, EASE_SOFT);
      items.forEach((it, i) => {
        const s = plan.items[i];
        if (!s) return;
        run(
          it,
          [
            { opacity: 0, transform: 'translateY(8px)' },
            { opacity: 1, transform: 'translateY(0)' },
          ],
          s.start,
          s.dur,
          EASE_SOFT,
        );
      });
      if (plan.fill) {
        for (const f of fills) {
          run(
            f,
            [{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }],
            plan.fill.start,
            plan.fill.dur,
            EASE_INK,
          );
        }
      }
      const fillAnim = plan.fill ? list[list.length - 1] : undefined;
      if (plan.seal) {
        for (const s of seals) {
          run(
            s,
            [
              { opacity: 0, transform: 'scale(1.25) rotate(-6deg)' },
              { opacity: 1, transform: 'scale(1) rotate(0deg)' },
            ],
            plan.seal.start,
            plan.seal.dur,
            EASE_INK,
          );
        }
      }
      if (plan.hint) for (const h of hints) run(h, fadeIn, plan.hint.start, plan.hint.dur, EASE_SOFT);
      cueTimer = setTimeout(cue, plan.actionsCue);

      // 百分比：读取填充条动画已缓动的进度，逐帧写入（只改文本节点的值，不替换节点，React 仍持有同一节点）
      if (fillAnim && pcts.length > 0) {
        const tick = () => {
          const progress = fillAnim.effect?.getComputedTiming().progress;
          const done = fillAnim.playState === 'finished' || fillAnim.playState === 'idle';
          for (const p of pcts) {
            const node = p.firstChild;
            if (!node) continue;
            const final = p.dataset.pctFinal ?? '';
            const target = Number(p.dataset.pctTarget ?? 0);
            node.nodeValue = done || target <= 0 ? final : `${countUpValue(target, progress)}%`;
          }
          if (!done) requestAnimationFrame(tick);
        };
        tick();
      }
    }
    anims.current = list;

    await new Promise<void>((resolve) => {
      let settled = false;
      const onInput = () => skip();
      const finish = () => {
        if (settled) return;
        settled = true;
        finishRef.current = null;
        window.removeEventListener('pointerdown', onInput, true);
        window.removeEventListener('keydown', onInput, true);
        for (const p of pcts) {
          if (p.firstChild) p.firstChild.nodeValue = p.dataset.pctFinal ?? '';
        }
        cancelAll();
        clearDust();
        setState('shown');
        cue();
        resolve();
      };
      finishRef.current = finish;
      // 显现过程中点击或按任意键：立即跳到最终状态
      window.addEventListener('pointerdown', onInput, true);
      window.addEventListener('keydown', onInput, true);
      Promise.all(list.map((a) => a.finished)).then(finish, finish);
    });
  }, [rootRef, cancelAll, clearDust, skip, setState]);

  const dissolve = useCallback(async (): Promise<void> => {
    const root = rootRef.current;
    if (!root) return;
    if (root.dataset.inkState === 'revealing') skip();
    if (root.dataset.inkState === 'hidden') return;
    cancelAll();
    const reduced = prefersReducedMotion();
    const blocks = all(root, '[data-ink-block]').reverse();
    // 照片与相角先于提问淡去（15 §11.3）：竖屏时照片在 DOM 中位于提问之前，挪到提问之前淡出
    const photoBlock = blocks.find((b) => b.hasAttribute('data-photo-block'));
    const heading = blocks.find((b) => b.hasAttribute('data-focus-heading'));
    if (photoBlock && heading && blocks.indexOf(photoBlock) > blocks.indexOf(heading)) {
      blocks.splice(blocks.indexOf(photoBlock), 1);
      blocks.splice(blocks.indexOf(heading), 0, photoBlock);
    }
    const list: Animation[] = [];
    setState('dissolving');
    if (reduced) {
      list.push(
        root.animate([{ opacity: 1 }, { opacity: 0 }], { duration: INK.reducedDur, fill: 'forwards' }),
      );
    } else {
      // 相反顺序：选项 → 提问（横屏先右页后左页），模糊 0 → 2 px（lite 不模糊）
      const stagger = dissolveStagger(blocks.length);
      blocks.forEach((b, i) => {
        list.push(
          b.animate(
            liteRef.current
              ? [{ opacity: 1 }, { opacity: 0 }]
              : [
                  { opacity: 1, filter: 'blur(0px)' },
                  { opacity: 0, filter: 'blur(2px)' },
                ],
            { delay: i * stagger, duration: INK.dissolveDur, easing: EASE_SOFT, fill: 'forwards' },
          ),
        );
      });
    }
    anims.current = list;
    await Promise.all(list.map((a) => a.finished)).catch(() => undefined);
    // 先切到 hidden（CSS 隐藏全部墨迹），再撤掉动画，避免闪一帧
    setState('hidden');
    cancelAll();
  }, [
    rootRef,
    cancelAll,
    skip, // 先切到 hidden（CSS 隐藏全部墨迹），再撤掉动画，避免闪一帧
    setState,
  ]);

  useEffect(
    () => () => {
      finishRef.current = null;
      for (const a of anims.current) a.cancel();
      clearDust();
    },
    [clearDust],
  );

  return { reveal, skip, dissolve };
}
