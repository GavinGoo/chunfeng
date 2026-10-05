/**
 * 书的状态机（07 §4）：带类型的 reducer + 显式转移表。副作用（动画、请求、URL）在 useBookEffects 中根据状态触发。
 *
 * 约定：
 * - `run`：每次开始一个新操作（提问、再翻一次、再试一次、合上、前进/后退）时递增；
 *   异步副作用回来时带上自己的 run，与当前 run 不同的事件被静默丢弃（旧请求、被取消的动画）。
 * - 结果（RESULT）在 opening / dissolving 期间先记录在 `pending`，封面打开或旧内容淡去后直接进入 settling；
 *   flipping 期间收到结果立即进入 settling —— 最短翻页时长由引擎的 stop() 保证（09 §5）。
 * - 非法转移：开发环境 console.warn，状态不变。
 */

import type { ClientError } from '@/lib/client/createReading';
import type { HelpResource, NoticeStatus, Reading } from '@/lib/shared/types';

export type Phase =
  | 'closed'
  | 'opening'
  | 'flipping'
  | 'settling'
  | 'revealing'
  | 'open'
  | 'dissolving'
  | 'closing';

/** 这一次翻书的内容来源：新提问（POST），或按 id 取回已有答案（GET，前进/后退时） */
export type Source =
  | {
      kind: 'create';
      question: string;
      requestId: string;
      regenOf?: string;
      /** 附图的 id（15 §10.7）；「再翻一次」不带，服务端沿用上一条的图 */
      imageId?: string;
      /** 这次提问带图（含「再翻一次」沿用的图）：翻页提示与提示页的「附图一张」 */
      hasImage?: boolean;
    }
  | { kind: 'fetch'; id: string };

/** 翻页方式：循环翻到结果就绪（loop），或只翻一页（once，恢复历史记录中的答案） */
export type FlipMode = 'loop' | 'once';

export type Outcome =
  | { kind: 'ok'; reading: Reading; owner: boolean }
  | {
      kind: 'notice';
      status: NoticeStatus;
      message: string;
      resources?: HelpResource[];
      question: string;
      hasImage?: boolean;
    }
  | { kind: 'error'; error: ClientError; question: string; retryAt?: number; hasImage?: boolean }
  | { kind: 'notFound' };

export interface BookState {
  phase: Phase;
  run: number;
  source: Source | null;
  flip: FlipMode;
  /** 已到达、尚未显现的结果 */
  pending: Outcome | null;
  /** 纸页上的内容（revealing / open / dissolving / closing） */
  content: Outcome | null;
  /** 当前内容是在哪一次操作中落定的（0 = 服务端渲染的初始内容）；用作答案组件的 key */
  contentRun: number;
  /** 合书后预填到铭牌的问题（「重新提问」、BAD_REQUEST） */
  prefill?: string;
  /** 合书后铭牌下方的常驻提示 */
  hint?: CoverHint;
}

export type PopTarget = { kind: 'home' } | { kind: 'reading'; id: string };

export type BookEvent =
  | { type: 'SUBMIT'; question: string; requestId: string; imageId?: string }
  | { type: 'COVER_OPENED'; run: number }
  | { type: 'RESULT'; run: number; outcome: Outcome }
  | { type: 'SETTLED'; run: number }
  | { type: 'REVEALED'; run: number }
  | { type: 'SKIP' }
  | { type: 'REGENERATE'; requestId: string }
  | { type: 'RETRY' }
  | { type: 'DISSOLVED'; run: number }
  | { type: 'CLOSE'; prefill?: string; hint?: CoverHint }
  | { type: 'CLOSED'; run: number }
  | { type: 'POP'; target: PopTarget }
  | { type: 'OWNER'; owner: boolean };

export type EventType = BookEvent['type'];

/**
 * 显式转移表：事件 → 允许的起始状态 → 可能的目标状态（供文档与测试核对；reducer 的实际分支必须与之一致）。
 */
export const TRANSITIONS: Record<EventType, Partial<Record<Phase, readonly Phase[]>>> = {
  SUBMIT: { closed: ['opening'] },
  COVER_OPENED: { opening: ['flipping', 'settling'] },
  RESULT: {
    opening: ['opening', 'closing'],
    flipping: ['settling', 'closing'],
    dissolving: ['dissolving', 'closing'],
  },
  SETTLED: { settling: ['revealing'] },
  REVEALED: { revealing: ['open'] },
  SKIP: { revealing: ['open'] },
  REGENERATE: { open: ['dissolving'] },
  RETRY: { open: ['dissolving'] },
  DISSOLVED: { dissolving: ['flipping', 'settling'] },
  CLOSE: {
    opening: ['closing'],
    flipping: ['closing'],
    settling: ['closing'],
    open: ['closing'],
    dissolving: ['closing'],
  },
  CLOSED: { closing: ['closed'] },
  POP: {
    closed: ['closed', 'opening'],
    opening: ['closing'],
    flipping: ['closing'],
    settling: ['closing'],
    revealing: ['closing'],
    open: ['open', 'closing', 'dissolving'],
    dissolving: ['closing'],
    closing: ['closing'],
  },
  OWNER: {
    closed: ['closed'],
    opening: ['opening'],
    flipping: ['flipping'],
    settling: ['settling'],
    revealing: ['revealing'],
    open: ['open'],
    dissolving: ['dissolving'],
    closing: ['closing'],
  },
};

/** 结果需要直接回到封面、在铭牌下提示的错误码（05 §2、15 §10.8）→ 合书后的提示 */
const BACK_TO_COVER: Readonly<Record<string, CoverHint>> = {
  BAD_REQUEST: 'badRequest',
  PAYLOAD_TOO_LARGE: 'badRequest',
  IMAGE_NOT_FOUND: 'imageExpired',
  VISION_DISABLED: 'visionDisabled',
};

/** 合书后铭牌下方的常驻提示；imageExpired / visionDisabled 还会清除附图（后者隐藏附图入口） */
export type CoverHint = 'badRequest' | 'imageExpired' | 'visionDisabled';

export type InitialBook = { kind: 'closed' } | { kind: 'open'; reading: Reading } | { kind: 'notFound' };

export function initialState(initial: InitialBook): BookState {
  if (initial.kind === 'closed')
    return {
      phase: 'closed',
      run: 0,
      source: null,
      flip: 'loop',
      pending: null,
      content: null,
      contentRun: 0,
    };
  const content: Outcome =
    initial.kind === 'open'
      ? // 主人 / 访客在挂载后由 chunfeng:mine 决定（OWNER 事件）；SSR 先按访客渲染
        { kind: 'ok', reading: initial.reading, owner: false }
      : { kind: 'notFound' };
  return {
    phase: 'open',
    run: 0,
    source: initial.kind === 'open' ? { kind: 'fetch', id: initial.reading.id } : null,
    flip: 'once',
    pending: null,
    content,
    contentRun: 0,
  };
}

const IS_DEV = process.env.NODE_ENV !== 'production';

function illegal(state: BookState, event: BookEvent): BookState {
  if (IS_DEV && process.env.NODE_ENV !== 'test') {
    console.warn(`[book] 非法转移：${event.type} @ ${state.phase}`);
  }
  return state;
}

/** 是否为「只更新数据、不算转移」的旧事件（run 已过期） */
function stale(state: BookState, event: BookEvent): boolean {
  return 'run' in event && event.run !== state.run;
}

function questionOf(state: BookState): string {
  const s = state.source;
  if (s?.kind === 'create') return s.question;
  const c = state.content;
  if (c?.kind === 'ok') return c.reading.question;
  return '';
}

export function bookReducer(state: BookState, event: BookEvent): BookState {
  if (stale(state, event)) return state;
  const { phase } = state;

  switch (event.type) {
    case 'SUBMIT':
      if (phase !== 'closed') return illegal(state, event);
      return {
        phase: 'opening',
        run: state.run + 1,
        source: {
          kind: 'create',
          question: event.question,
          requestId: event.requestId,
          ...(event.imageId ? { imageId: event.imageId, hasImage: true } : {}),
        },
        flip: 'loop',
        pending: null,
        content: null,
        contentRun: state.contentRun,
      };

    case 'COVER_OPENED':
      if (phase !== 'opening') return illegal(state, event);
      return { ...state, phase: state.pending ? 'settling' : 'flipping' };

    case 'RESULT': {
      if (phase !== 'opening' && phase !== 'flipping' && phase !== 'dissolving') return illegal(state, event);
      const o = event.outcome;
      const back = o.kind === 'error' ? BACK_TO_COVER[o.error.code] : undefined;
      if (o.kind === 'error' && back) {
        return {
          ...state,
          phase: 'closing',
          run: state.run + 1,
          pending: null,
          prefill: o.question,
          hint: back,
        };
      }
      if (phase === 'flipping') return { ...state, phase: 'settling', pending: o };
      return { ...state, pending: o };
    }

    case 'SETTLED':
      if (phase !== 'settling' || !state.pending) return illegal(state, event);
      return { ...state, phase: 'revealing', content: state.pending, pending: null, contentRun: state.run };

    case 'REVEALED':
    case 'SKIP':
      if (phase !== 'revealing') {
        // 跳过后显现 promise 仍会 resolve：已在 open 时静默忽略
        return phase === 'open' ? state : illegal(state, event);
      }
      return { ...state, phase: 'open' };

    case 'REGENERATE': {
      const c = state.content;
      if (phase !== 'open' || c?.kind !== 'ok' || !c.owner) return illegal(state, event);
      return {
        ...state,
        phase: 'dissolving',
        run: state.run + 1,
        source: {
          kind: 'create',
          question: c.reading.question,
          requestId: event.requestId,
          regenOf: c.reading.id,
          ...(c.reading.image ? { hasImage: true } : {}),
        },
        flip: 'loop',
        pending: null,
      };
    }

    case 'RETRY':
      // 复用同一个来源（create 时即同一个 requestId，服务端据此复用已缓存的 LLM 结果）
      if (phase !== 'open' || state.content?.kind !== 'error' || !state.source) return illegal(state, event);
      return { ...state, phase: 'dissolving', run: state.run + 1, pending: null };

    case 'DISSOLVED':
      if (phase !== 'dissolving') return illegal(state, event);
      return { ...state, phase: state.pending ? 'settling' : 'flipping' };

    case 'CLOSE':
      if (!(phase in TRANSITIONS.CLOSE)) return illegal(state, event);
      return {
        ...state,
        phase: 'closing',
        run: state.run + 1,
        pending: null,
        prefill: event.prefill,
        hint: event.hint,
      };

    case 'CLOSED':
      if (phase !== 'closing') return illegal(state, event);
      return { ...state, phase: 'closed', source: null, content: null, pending: null };

    case 'POP': {
      const t = event.target;
      if (t.kind === 'home') {
        if (phase === 'closed' || phase === 'closing') return state;
        return {
          ...state,
          phase: 'closing',
          run: state.run + 1,
          pending: null,
          prefill: undefined,
          hint: undefined,
        };
      }
      if (phase === 'closed') {
        return {
          phase: 'opening',
          run: state.run + 1,
          source: { kind: 'fetch', id: t.id },
          flip: 'once',
          pending: null,
          content: null,
          contentRun: state.contentRun,
        };
      }
      if (phase === 'open') {
        const c = state.content;
        if (c?.kind === 'ok' && c.reading.id === t.id) return state;
        return {
          ...state,
          phase: 'dissolving',
          run: state.run + 1,
          source: { kind: 'fetch', id: t.id },
          flip: 'once',
          pending: null,
        };
      }
      // 动画进行中前进到另一条答案：先合上（与浏览器的地址不一致时以书的状态为准）
      return illegal(state, event);
    }

    case 'OWNER': {
      const c = state.content;
      if (c?.kind !== 'ok' || c.owner === event.owner) return state;
      return { ...state, content: { ...c, owner: event.owner } };
    }
  }
}

/** 当前内容对应的问题（错误页「重新提问」等使用） */
export function currentQuestion(state: BookState): string {
  return questionOf(state);
}

/** 背景活跃态（10 §2）：opening、flipping、settling */
/**
 * 光幕阶段（09 §5.1）：只在持续翻页（新提问、再翻一次、重试）时有光——翻页中透光，落页时微光；
 * 浏览器前进后退恢复答案（只翻一页）与 SSR 直达（没有翻页）不播放。
 */
export function lumenPhase(state: Pick<BookState, 'phase' | 'flip'>): 'off' | 'flow' | 'bloom' {
  if (state.flip !== 'loop') return 'off';
  if (isAmbientActive(state.phase)) return 'flow';
  return state.phase === 'revealing' ? 'bloom' : 'off';
}

export function isAmbientActive(phase: Phase): boolean {
  return phase === 'opening' || phase === 'flipping' || phase === 'settling';
}
