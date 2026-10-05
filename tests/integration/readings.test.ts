import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { GET as health } from '@/app/api/health/route';
import type { Reading } from '@/lib/shared/types';
import { mockStats, resetMockStats } from '@/server/mock/faults';
import { getDb } from '@/server/reading/db';
import { getPublicReading } from '@/server/reading/public';
import { freshIp, get, post, setupEnv, uuid } from './helpers';

let env: ReturnType<typeof setupEnv>;
beforeAll(() => {
  env = setupEnv();
});
afterAll(() => env.cleanup());
beforeEach(() => resetMockStats());

const count = () => (getDb().prepare('SELECT COUNT(*) AS n FROM readings').get() as { n: number }).n;

describe('POST /api/readings：正常流程', () => {
  it('返回 4 个选项，pct 之和为 100，字母按 prob 降序；已落库，GET 可读回', async () => {
    const requestId = uuid();
    const { status, json, res } = await post(
      { question: '  工作三年了，要不要\n跳槽去创业公司？ ', requestId, tz: 'America/New_York' },
      { 'x-real-ip': freshIp() },
    );
    expect(status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(json.status).toBe('ok');
    const reading = json.reading as Reading;
    expect(reading.id).toMatch(/^[A-Za-z0-9]{12}$/);
    expect(reading.question).toBe('工作三年了，要不要 跳槽去创业公司？');
    expect(reading.tz).toBe('America/New_York');
    expect(reading.pageNo).toBeGreaterThanOrEqual(100);
    expect(reading.pageNo).toBeLessThanOrEqual(999);
    expect(reading.options.map((o) => o.letter)).toEqual(['A', 'B', 'C', 'D']);
    expect(reading.options.reduce((a, o) => a + o.pct, 0)).toBe(100);
    expect(reading.options.reduce((a, o) => a + o.prob, 0)).toBeCloseTo(1, 10);
    for (let i = 1; i < 4; i++)
      expect(reading.options[i - 1]!.prob).toBeGreaterThanOrEqual(reading.options[i]!.prob);
    expect(reading.regenOf).toBeUndefined();
    // 内部数据不下发
    expect(JSON.stringify(json)).not.toMatch(/brief|questionEn|ipHash|raw/);
    expect(mockStats()).toMatchObject({ llmCalls: 1, jevCalls: 1 });

    const got = await get(reading.id);
    expect(got.status).toBe(200);
    expect(got.res.headers.get('cache-control')).toBe('private, max-age=60');
    expect(got.json).toEqual({ reading });
    expect(getPublicReading(reading.id)).toEqual(reading);
  });

  it('同一 requestId 重放：返回相同结果，不再调用上游', async () => {
    const requestId = uuid();
    const ip = freshIp();
    const first = await post({ question: '要不要养一只猫？', requestId }, { 'x-real-ip': ip });
    resetMockStats();
    const again = await post({ question: '要不要养一只猫？', requestId }, { 'x-real-ip': ip });
    expect(again.json).toEqual(first.json);
    expect(mockStats()).toMatchObject({ llmCalls: 0, jevCalls: 0 });
  });

  it('同一 requestId 但问题不同 → 400', async () => {
    const requestId = uuid();
    await post({ question: '要不要养一只猫？', requestId }, { 'x-real-ip': freshIp() });
    const r = await post({ question: '要不要养一只狗？', requestId }, { 'x-real-ip': freshIp() });
    expect(r.status).toBe(400);
    expect(r.json).toMatchObject({ error: { code: 'BAD_REQUEST', retryable: false, requestId } });
  });

  it('非法 tz 回退 Asia/Shanghai', async () => {
    const r = await post(
      { question: '周末去海边还是爬山？', requestId: uuid(), tz: 'Mars/Base' },
      { 'x-real-ip': freshIp() },
    );
    expect((r.json.reading as Reading).tz).toBe('Asia/Shanghai');
  });

  it('再翻一次：带 regenOf，选项与上一次不同', async () => {
    const q = '要不要换工作？';
    const first = (await post({ question: q, requestId: uuid() }, { 'x-real-ip': freshIp() })).json
      .reading as Reading;
    const second = await post(
      { question: q, requestId: uuid(), regenOf: first.id },
      { 'x-real-ip': freshIp() },
    );
    const r2 = second.json.reading as Reading;
    expect(r2.id).not.toBe(first.id);
    expect(r2.regenOf).toBe(first.id);
    const oldTitles = new Set(first.options.map((o) => o.title));
    expect(r2.options.filter((o) => oldTitles.has(o.title))).toHaveLength(0);
  });

  it('regenOf 不存在或格式不对时忽略', async () => {
    const a = await post(
      { question: '要不要换工作？', requestId: uuid(), regenOf: 'ZZZZZZZZZZZZ' },
      { 'x-real-ip': freshIp() },
    );
    expect(a.status).toBe(200);
    expect((a.json.reading as Reading).regenOf).toBeUndefined();
    const b = await post(
      { question: '要不要换工作？', requestId: uuid(), regenOf: '../../etc' },
      { 'x-real-ip': freshIp() },
    );
    expect(b.status).toBe(200);
  });
});

describe('分流：不落库、不调用 JEV', () => {
  it.each([
    ['unclear', '你好', { llmCalls: 1, jevCalls: 0 }],
    ['refused', '怎么买到毒品', { llmCalls: 1, jevCalls: 0 }],
    ['sensitive', '他威胁我的人身安全，要不要报警', { llmCalls: 1, jevCalls: 0 }],
    ['sensitive', '我真的不想活了', { llmCalls: 0, jevCalls: 0 }], // 危机词预检：连 LLM 也不调用
  ])('%s：%s', async (expected, question, calls) => {
    const before = count();
    const { status, json } = await post({ question, requestId: uuid() }, { 'x-real-ip': freshIp() });
    expect(status).toBe(200);
    expect(json.status).toBe(expected);
    expect(typeof json.message).toBe('string');
    if (expected === 'sensitive') {
      const resources = json.resources as { name: string; phone?: string; url?: string }[];
      expect(resources.map((r) => r.phone)).toContain('12356');
      expect(resources.at(-1)).toEqual({
        name: '猫猫很想你，来看看它们吧 🐾',
        url: 'https://space.bilibili.com/11933497/favlist?fid=989271197',
      });
    } else {
      expect(json.resources).toBeUndefined();
    }
    expect(json.reading).toBeUndefined();
    expect(mockStats()).toMatchObject(calls);
    expect(count()).toBe(before);
  });
});

describe('入参校验与防滥用', () => {
  it.each([
    ['非 JSON', '{not json'],
    ['缺少 requestId', { question: '要不要换工作？' }],
    ['requestId 不是 UUID v4', { question: '要不要换工作？', requestId: '123' }],
    ['question 太短', { question: ' 好 ', requestId: '0b6f8f3e-6a0e-4f0b-9a57-1d2a6c1b9e21' }],
    ['question 只有零宽字符', { question: '​​​', requestId: '0b6f8f3e-6a0e-4f0b-9a57-1d2a6c1b9e21' }],
    [
      'question 超过 200 字',
      { question: '字'.repeat(201), requestId: '0b6f8f3e-6a0e-4f0b-9a57-1d2a6c1b9e21' },
    ],
  ])('%s → 400', async (_name, body) => {
    const r = await post(body, { 'x-real-ip': freshIp() });
    expect(r.status).toBe(400);
    expect(r.json).toMatchObject({ error: { code: 'BAD_REQUEST', retryable: false } });
  });

  it('请求体 > 4 KB → 413', async () => {
    const r = await post({ question: '要不要换工作？', requestId: uuid(), pad: 'x'.repeat(5000) });
    expect(r.status).toBe(413);
    expect(r.json).toMatchObject({ error: { code: 'PAYLOAD_TOO_LARGE' } });
  });

  it('跨域 Origin → 403；Origin 缺失放行', async () => {
    const r = await post(
      { question: '要不要换工作？', requestId: uuid() },
      { origin: 'https://evil.example' },
    );
    expect(r.status).toBe(403);
    expect(r.json).toMatchObject({ error: { code: 'FORBIDDEN_ORIGIN', retryable: false } });
    expect(mockStats().llmCalls).toBe(0);
    const noOrigin = await post(
      { question: '要不要换工作？', requestId: uuid() },
      { origin: '', 'x-real-ip': freshIp() },
    );
    expect(noOrigin.status).toBe(200);
  });
});

describe('GET /api/readings/[id]', () => {
  it('不存在 → 404', async () => {
    for (const id of ['AAAAAAAAAAAA', 'bad', '../../../etc']) {
      const r = await get(id);
      expect(r.status).toBe(404);
      expect(r.json).toMatchObject({ error: { code: 'NOT_FOUND', retryable: false } });
    }
    expect(getPublicReading('nope')).toBeNull();
  });
});

describe('GET /api/health', () => {
  it('进程与数据库正常', async () => {
    const res = await health();
    expect(res.status).toBe(200);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json).toMatchObject({ ok: true, db: 'ok' });
    expect(typeof json.version).toBe('string');
    expect(typeof json.uptimeSec).toBe('number');
  });
});
