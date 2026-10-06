// 选项说明的展开与收起（11 §4.3）：只动画 transform，不逐帧改布局。
//
// 做法是 FLIP：点按时记下滚动区内各块的位置（First），React 提交后布局一次到位（Last），
// 再让移动了的块从原位置滑到新位置；说明正文与外框的下半截（含下边框与两个下圆角）一起从选项下方滑出 / 收回。
// 收起时说明先留在布局里，由条目上的负 margin-bottom 抵消它的高度，后面的块因此一开始就在终点；滑完再真正隐藏。
//
// 原先用 grid-template-rows 0fr → 1fr 过渡，iOS Safari 每帧重新排版、重绘整个滚动区，展开明显掉帧。

import { prefersReducedMotion } from '@/components/flip/common';
import { revealInScroll } from './ScrollArea';

const DURATION = 320; // --dur-medium
const EASING = 'cubic-bezier(.2,.7,.2,1)'; // --ease-soft

export interface ExpandSnapshot {
  /** 滚动区内各块点按时的视觉位置（含进行中的位移） */
  tops: Map<Element, number>;
  /** 说明正文相对裁切框的当前位移；说明不可见时为 null */
  bodyOffset: number | null;
}

interface Session {
  anims: Animation[];
  cleanup(): void;
}

let session: Session | null = null;

function parts(item: HTMLElement) {
  return {
    panel: item.querySelector<HTMLElement>('[data-panel]'),
    clip: item.querySelector<HTMLElement>('[data-panel-clip]'),
    body: item.querySelector<HTMLElement>('[data-panel-body]'),
    frame: item.querySelector<HTMLElement>('[data-frame-bottom]'),
  };
}

/** 条目自身，以及从它到滚动区内容根之间每一层的兄弟节点：这些块互不嵌套，各自位移即可 */
function movers(item: HTMLElement): HTMLElement[] {
  const root = item.closest('[data-scroll]')?.firstElementChild ?? item.parentElement;
  const out: HTMLElement[] = [item];
  let cur: HTMLElement = item;
  while (cur !== root && cur.parentElement) {
    for (const sib of cur.parentElement.children)
      if (sib !== cur && sib instanceof HTMLElement) out.push(sib);
    if (cur.parentElement === root) break;
    cur = cur.parentElement;
  }
  return out;
}

/** 点按时（React 更新之前）调用 */
export function captureExpand(item: HTMLElement): ExpandSnapshot {
  const tops = new Map<Element, number>();
  for (const el of movers(item)) tops.set(el, el.getBoundingClientRect().top);
  const { clip, body } = parts(item);
  const visible = !!clip && !!body && clip.getClientRects().length > 0;
  return {
    tops,
    bodyOffset: visible ? body.getBoundingClientRect().top - clip.getBoundingClientRect().top : null,
  };
}

/** React 提交新的 expanded 之后（layout effect 中）调用 */
export function playExpand(item: HTMLElement, expanded: boolean, snap: ExpandSnapshot): void {
  session?.anims.forEach((a) => {
    a.cancel();
  });
  session?.cleanup();
  session = null;

  const { panel, clip, body, frame } = parts(item);
  if (!panel || !clip || !body || !frame) return;
  if (prefersReducedMotion()) {
    if (expanded) revealInScroll(panel);
    return;
  }

  let cleanup = () => {};
  if (!expanded) {
    // 收起：说明留在布局里滑走，负 margin 让后面的块直接按收起后的位置排
    const base = item.style.marginBottom;
    const mb = Number.parseFloat(getComputedStyle(item).marginBottom) || 0;
    item.dataset.collapsing = '';
    item.style.marginBottom = `${mb - clip.offsetHeight}px`;
    cleanup = () => {
      delete item.dataset.collapsing;
      item.style.marginBottom = base;
    };
  }
  const h = clip.offsetHeight;
  const from = snap.bodyOffset ?? (expanded ? -h : 0);
  const to = expanded ? 0 : -h;

  const anims: Animation[] = [];
  const opts: KeyframeAnimationOptions = { duration: DURATION, easing: EASING };
  for (const el of movers(item)) {
    const first = snap.tops.get(el);
    if (first === undefined) continue;
    const dy = first - el.getBoundingClientRect().top;
    if (Math.abs(dy) < 0.5) continue;
    anims.push(el.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], opts));
  }
  const slide = [{ transform: `translateY(${from}px)` }, { transform: `translateY(${to}px)` }];
  const bodyAnim = body.animate(slide, { ...opts, fill: 'both' });
  anims.push(bodyAnim, frame.animate(slide, { ...opts, fill: 'both' }));

  const current: Session = { anims, cleanup };
  session = current;
  bodyAnim.finished.then(
    () => {
      if (session !== current) return;
      session = null;
      for (const a of anims) a.cancel();
      cleanup();
      if (expanded) revealInScroll(panel);
    },
    () => undefined,
  );
}
