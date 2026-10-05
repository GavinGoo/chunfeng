import { describe, expect, it } from 'vitest';
import {
  type BookEvent,
  type BookState,
  bookReducer,
  type EventType,
  initialState,
  isAmbientActive,
  lumenPhase,
  type Outcome,
  type Phase,
  TRANSITIONS,
} from '@/components/book/machine';
import type { Reading } from '@/lib/shared/types';

const reading = (id = 'AAAAAAAAAAAA', question = '要不要换工作？'): Reading => ({
  id,
  question,
  createdAt: '2026-09-27T13:40:00.000Z',
  tz: 'Asia/Shanghai',
  pageNo: 237,
  options: (['A', 'B', 'C', 'D'] as const).map((letter, i) => ({
    letter,
    title: `选项${i}`,
    desc: '说明',
    prob: 0.25,
    pct: 25,
  })),
});

const ok = (id?: string): Outcome => ({ kind: 'ok', reading: reading(id), owner: true });
const err = (code: 'JEV_UNAVAILABLE' | 'BAD_REQUEST' = 'JEV_UNAVAILABLE'): Outcome => ({
  kind: 'error',
  error: { code, message: 'x', retryable: code !== 'BAD_REQUEST', status: 502 },
  question: '要不要换工作？',
});

const run = (s: BookState, ...events: BookEvent[]) => events.reduce(bookReducer, s);
const closed = () => initialState({ kind: 'closed' });

/** 到达各个状态的最短路径（用于遍历转移表） */
function reach(phase: Phase, content: 'ok' | 'error' = 'ok'): BookState {
  const c = closed();
  const opening = run(c, { type: 'SUBMIT', question: '要不要换工作？', requestId: 'r1' });
  const r = () => opening.run;
  switch (phase) {
    case 'closed':
      return c;
    case 'opening':
      return opening;
    case 'flipping':
      return run(opening, { type: 'COVER_OPENED', run: r() });
    case 'settling':
      return run(opening, { type: 'COVER_OPENED', run: r() }, { type: 'RESULT', run: r(), outcome: ok() });
    case 'revealing':
      return run(reach('settling'), { type: 'SETTLED', run: r() });
    case 'open': {
      if (content === 'error') {
        return run(
          opening,
          { type: 'COVER_OPENED', run: r() },
          { type: 'RESULT', run: r(), outcome: err() },
          { type: 'SETTLED', run: r() },
          { type: 'REVEALED', run: r() },
        );
      }
      return run(reach('revealing'), { type: 'REVEALED', run: r() });
    }
    case 'dissolving':
      return run(reach('open'), { type: 'REGENERATE', requestId: 'r2' });
    case 'closing':
      return run(reach('open'), { type: 'CLOSE' });
  }
}

const PHASES: Phase[] = [
  'closed',
  'opening',
  'flipping',
  'settling',
  'revealing',
  'open',
  'dissolving',
  'closing',
];

function sample(type: EventType, s: BookState): BookEvent {
  switch (type) {
    case 'SUBMIT':
      return { type, question: '再问一次', requestId: 'r9' };
    case 'COVER_OPENED':
    case 'SETTLED':
    case 'REVEALED':
    case 'DISSOLVED':
    case 'CLOSED':
      return { type, run: s.run };
    case 'RESULT':
      return { type, run: s.run, outcome: ok('BBBBBBBBBBBB') };
    case 'SKIP':
    case 'RETRY':
      return { type };
    case 'REGENERATE':
      return { type, requestId: 'r3' };
    case 'CLOSE':
      return { type };
    case 'POP':
      return { type, target: { kind: 'home' } };
    case 'OWNER':
      return { type, owner: true };
  }
}

describe('书的状态机：转移表', () => {
  for (const type of Object.keys(TRANSITIONS) as EventType[]) {
    for (const phase of PHASES) {
      const allowed = TRANSITIONS[type][phase];
      const s = reach(phase, type === 'RETRY' ? 'error' : 'ok');
      it(`${type} @ ${phase} → ${allowed ? allowed.join(' | ') : '（非法，不变）'}`, () => {
        const next = bookReducer(s, sample(type, s));
        if (allowed) expect(allowed).toContain(next.phase);
        else expect(next).toBe(s);
      });
    }
  }
});

describe('书的状态机：主流程', () => {
  it('提问 → 打开 → 翻页 → 结果 → 落定 → 显现 → 打开态', () => {
    let s = run(closed(), { type: 'SUBMIT', question: '问', requestId: 'r1' });
    expect(s.phase).toBe('opening');
    expect(s.source).toEqual({ kind: 'create', question: '问', requestId: 'r1' });
    s = run(s, { type: 'COVER_OPENED', run: s.run });
    expect(s.phase).toBe('flipping');
    s = run(s, { type: 'RESULT', run: s.run, outcome: ok() });
    expect(s.phase).toBe('settling');
    expect(s.pending?.kind).toBe('ok');
    s = run(s, { type: 'SETTLED', run: s.run });
    expect(s.phase).toBe('revealing');
    expect(s.content?.kind).toBe('ok');
    expect(s.pending).toBeNull();
    s = run(s, { type: 'SKIP' });
    expect(s.phase).toBe('open');
    // 跳过后显现 promise 仍会 resolve：不报错、不变
    expect(run(s, { type: 'REVEALED', run: s.run })).toBe(s);
  });

  it('封面打开前就拿到结果：先记录，封面打开后直接落定', () => {
    let s = reach('opening');
    s = run(s, { type: 'RESULT', run: s.run, outcome: ok() });
    expect(s.phase).toBe('opening');
    expect(s.pending?.kind).toBe('ok');
    s = run(s, { type: 'COVER_OPENED', run: s.run });
    expect(s.phase).toBe('settling');
  });

  it('过期的事件（旧 run）被静默丢弃', () => {
    const s = reach('flipping');
    expect(run(s, { type: 'RESULT', run: s.run - 1, outcome: ok() })).toBe(s);
  });

  it('再翻一次：新的 requestId，regenOf 为当前答案；旧内容淡去期间结果先记录', () => {
    const open = reach('open');
    let s = run(open, { type: 'REGENERATE', requestId: 'r2' });
    expect(s.phase).toBe('dissolving');
    expect(s.run).toBe(open.run + 1);
    expect(s.source).toEqual({
      kind: 'create',
      question: '要不要换工作？',
      requestId: 'r2',
      regenOf: 'AAAAAAAAAAAA',
    });
    s = run(s, { type: 'RESULT', run: s.run, outcome: ok('CCCCCCCCCCCC') });
    expect(s.phase).toBe('dissolving');
    s = run(s, { type: 'DISSOLVED', run: s.run });
    expect(s.phase).toBe('settling');
  });

  it('访客不能再翻一次', () => {
    const s = run(initialState({ kind: 'open', reading: reading() }), { type: 'REGENERATE', requestId: 'x' });
    expect(s.phase).toBe('open');
  });

  it('再试一次复用 requestId', () => {
    const e = reach('open', 'error');
    const s = run(e, { type: 'RETRY' });
    expect(s.phase).toBe('dissolving');
    expect(s.source).toEqual(e.source);
    expect(s.source?.kind === 'create' && s.source.requestId).toBe('r1');
  });

  it('BAD_REQUEST：回到封面，预填原问题并提示', () => {
    const s0 = reach('flipping');
    const s = run(s0, { type: 'RESULT', run: s0.run, outcome: err('BAD_REQUEST') });
    expect(s.phase).toBe('closing');
    expect(s.prefill).toBe('要不要换工作？');
    expect(s.hint).toBe('badRequest');
  });

  it('带图（15 §10.7）：SUBMIT 携带 imageId；再翻一次不带 imageId，但记下 hasImage', () => {
    const s = run(closed(), {
      type: 'SUBMIT',
      question: '哪件好？',
      requestId: 'r1',
      imageId: 'Qm7xK2pT9cHd4Ls8',
    });
    expect(s.source).toEqual({
      kind: 'create',
      question: '哪件好？',
      requestId: 'r1',
      imageId: 'Qm7xK2pT9cHd4Ls8',
      hasImage: true,
    });
    const plain = run(closed(), { type: 'SUBMIT', question: '哪件好？', requestId: 'r1' });
    expect(plain.source).toEqual({ kind: 'create', question: '哪件好？', requestId: 'r1' });

    const open = initialState({
      kind: 'open',
      reading: { ...reading(), image: { width: 4, height: 3, alt: '' } },
    });
    const owned = run(open, { type: 'OWNER', owner: true });
    const regen = run(owned, { type: 'REGENERATE', requestId: 'r2' });
    expect(regen.source).toMatchObject({ kind: 'create', regenOf: 'AAAAAAAAAAAA', hasImage: true });
    expect(regen.source && 'imageId' in regen.source).toBe(false);
  });

  it('IMAGE_NOT_FOUND / VISION_DISABLED：回到封面，预填原问题并给出对应提示（15 §10.8）', () => {
    for (const [code, hint] of [
      ['IMAGE_NOT_FOUND', 'imageExpired'],
      ['VISION_DISABLED', 'visionDisabled'],
    ] as const) {
      const s0 = reach('flipping');
      const outcome: Outcome = {
        kind: 'error',
        error: { code, message: 'x', retryable: false, status: 400 },
        question: '要不要换工作？',
        hasImage: true,
      };
      const s = run(s0, { type: 'RESULT', run: s0.run, outcome });
      expect(s.phase).toBe('closing');
      expect(s.prefill).toBe('要不要换工作？');
      expect(s.hint).toBe(hint);
    }
  });

  it('翻页中合上：run 递增（取消请求），之后的结果被丢弃', () => {
    const f = reach('flipping');
    const s = run(f, { type: 'CLOSE' });
    expect(s.phase).toBe('closing');
    expect(run(s, { type: 'RESULT', run: f.run, outcome: ok() })).toBe(s);
    const c = run(s, { type: 'CLOSED', run: s.run });
    expect(c.phase).toBe('closed');
    expect(c.content).toBeNull();
  });

  it('重新提问：合上并预填', () => {
    const s = run(reach('open'), { type: 'CLOSE', prefill: '原来的问题' });
    expect(s.prefill).toBe('原来的问题');
  });

  it('后退到首页：打开态 → 合上；已合上时不变', () => {
    expect(run(reach('open'), { type: 'POP', target: { kind: 'home' } }).phase).toBe('closing');
    const c = closed();
    expect(run(c, { type: 'POP', target: { kind: 'home' } })).toBe(c);
  });

  it('前进到 /a/:id：合上时打开封面并只翻一页；打开态的同一条答案不变', () => {
    const s = run(closed(), { type: 'POP', target: { kind: 'reading', id: 'DDDDDDDDDDDD' } });
    expect(s.phase).toBe('opening');
    expect(s.flip).toBe('once');
    expect(s.source).toEqual({ kind: 'fetch', id: 'DDDDDDDDDDDD' });
    const open = reach('open');
    expect(run(open, { type: 'POP', target: { kind: 'reading', id: 'AAAAAAAAAAAA' } })).toBe(open);
    const other = run(open, { type: 'POP', target: { kind: 'reading', id: 'EEEEEEEEEEEE' } });
    expect(other.phase).toBe('dissolving');
    expect(other.flip).toBe('once');
  });

  it('SSR 初始态：打开 + 访客，挂载后按本机记录改为主人', () => {
    const s = initialState({ kind: 'open', reading: reading() });
    expect(s.phase).toBe('open');
    expect(s.content?.kind === 'ok' && s.content.owner).toBe(false);
    const o = run(s, { type: 'OWNER', owner: true });
    expect(o.content?.kind === 'ok' && o.content.owner).toBe(true);
    expect(initialState({ kind: 'notFound' }).content).toEqual({ kind: 'notFound' });
  });

  it('背景活跃态只在 opening / flipping / settling', () => {
    expect(PHASES.filter(isAmbientActive)).toEqual(['opening', 'flipping', 'settling']);
  });

  it('光幕（09 §5.1）：持续翻页时透光、落页时微光，其余时刻关闭', () => {
    expect(PHASES.map((p) => lumenPhase(reach(p)))).toEqual(
      PHASES.map((p) =>
        p === 'opening' || p === 'flipping' || p === 'settling'
          ? 'flow'
          : p === 'revealing'
            ? 'bloom'
            : 'off',
      ),
    );
  });

  it('光幕：SSR 直达与前进后退恢复答案（只翻一页）不播放', () => {
    const ssr = initialState({ kind: 'open', reading: reading() });
    expect(lumenPhase(ssr)).toBe('off');
    const popped = run(closed(), { type: 'POP', target: { kind: 'reading', id: 'AAAAAAAAAAAA' } });
    expect(popped.phase).toBe('opening');
    expect(lumenPhase(popped)).toBe('off');
    expect(lumenPhase({ phase: 'revealing', flip: 'once' })).toBe('off');
    const other = run(reach('open'), { type: 'POP', target: { kind: 'reading', id: 'EEEEEEEEEEEE' } });
    expect(lumenPhase(other)).toBe('off');
  });
});
