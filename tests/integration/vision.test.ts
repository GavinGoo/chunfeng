import { existsSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { GET as health } from '@/app/api/health/route';
import { GET as getImage } from '@/app/api/readings/[id]/image/route';
import { POST as postUpload } from '@/app/api/uploads/route';
import type { UploadImageResponse } from '@/lib/shared/image';
import type { Reading } from '@/lib/shared/types';
import { setSharpAvailableForTests } from '@/server/image/vision';
import { MOCK_IMAGE_ALT } from '@/server/llm/mock';
import { mockStats, resetMockStats, setMockFail } from '@/server/mock/faults';
import { getDb } from '@/server/reading/db';
import { runOrphanImageCleanup } from '@/server/reading/maintenance';
import { BASE, freshIp, HOST, post, setupEnv, uuid } from './helpers';

// 图片提问的集成测试（15 §16.2）

async function jpeg(width = 640, height = 480): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: '#2b5d44' } })
    .jpeg()
    .withExif({ IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '31/1 12/1 0/1' } })
    .toBuffer();
}

function uploadRequest(body: BodyInit | null, headers: Record<string, string> = {}): Request {
  return new Request(`${BASE}/api/uploads`, {
    method: 'POST',
    headers: { 'content-type': 'image/jpeg', origin: BASE, host: HOST, 'x-real-ip': freshIp(), ...headers },
    body,
  });
}

async function upload(
  body: BodyInit | null,
  headers: Record<string, string> = {},
): Promise<{ status: number; json: Record<string, unknown>; res: Response }> {
  const res = await postUpload(uploadRequest(body, headers));
  return { status: res.status, json: (await res.json()) as Record<string, unknown>, res };
}

async function image(id: string, query = '', headers: Record<string, string> = {}): Promise<Response> {
  return getImage(new Request(`${BASE}/api/readings/${id}/image${query}`, { headers }), {
    params: Promise.resolve({ id }),
  });
}

const count = (table: string) =>
  (getDb().prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;

describe('LLM_VISION=true', () => {
  let env: ReturnType<typeof setupEnv>;
  let imageDir: string;
  beforeAll(() => {
    env = setupEnv({
      LLM_VISION: 'true',
      UPLOAD_RATE_LIMIT_PER_MIN: '1000',
      UPLOAD_RATE_LIMIT_PER_DAY: '10000',
    });
    imageDir = join(env.dir, 'images');
    process.env.IMAGE_DIR = imageDir;
    setSharpAvailableForTests(undefined);
  });
  afterAll(() => {
    delete process.env.IMAGE_DIR;
    delete process.env.LLM_VISION;
    env.cleanup();
  });
  beforeEach(() => {
    resetMockStats();
    setMockFail('');
  });

  async function uploaded(): Promise<UploadImageResponse> {
    const r = await upload(new Uint8Array(await jpeg()));
    expect(r.status).toBe(201);
    return r.json as unknown as UploadImageResponse;
  }

  it('health 报告 vision: on', async () => {
    expect(await (await health()).json()).toMatchObject({ vision: 'on' });
  });

  it('上传：201，文件存在且元数据已移除', async () => {
    const r = await upload(new Uint8Array(await jpeg(4000, 3000)));
    expect(r.status).toBe(201);
    expect(r.res.headers.get('cache-control')).toBe('no-store');
    const data = r.json as unknown as UploadImageResponse;
    expect(data.imageId).toMatch(/^[0-9A-Za-z]{16}$/);
    expect(data.width * data.height).toBeLessThanOrEqual(1_700_000);
    const full = join(imageDir, data.imageId.slice(0, 2), `${data.imageId}.jpg`);
    expect(existsSync(full)).toBe(true);
    expect(existsSync(join(imageDir, data.imageId.slice(0, 2), `${data.imageId}.t.jpg`))).toBe(true);
    const meta = await sharp(full).metadata();
    expect(meta.exif).toBeUndefined();
    expect(Object.keys(r.json).sort()).toEqual(['height', 'imageId', 'width']);
  });

  it('413：Content-Length 或实际大小超过 8 MiB', async () => {
    const big = new Uint8Array(8 * 1024 * 1024 + 1);
    big.set([0xff, 0xd8, 0xff]);
    const r = await upload(big);
    expect(r.status).toBe(413);
    expect(r.json).toMatchObject({ error: { code: 'PAYLOAD_TOO_LARGE' } });
    // 不带 Content-Length 的流
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        for (let i = 0; i < 9; i++) c.enqueue(new Uint8Array(1024 * 1024));
        c.close();
      },
    });
    const res = await postUpload(
      new Request(`${BASE}/api/uploads`, {
        method: 'POST',
        headers: { origin: BASE, host: HOST, 'x-real-ip': freshIp() },
        body: stream,
        duplex: 'half',
      } as RequestInit),
    );
    expect(res.status).toBe(413);
  });

  it('415：SVG、HEIC、PDF、文本', async () => {
    for (const body of [
      '<svg xmlns="http://www.w3.org/2000/svg"><image href="http://evil.test/x.png"/></svg>',
      '%PDF-1.7\n%âãÏÓ',
      'just some text, definitely not an image',
    ]) {
      const r = await upload(body, { 'content-type': 'image/jpeg' });
      expect(r.status).toBe(415);
      expect(r.json).toMatchObject({ error: { code: 'UNSUPPORTED_MEDIA', retryable: false } });
    }
    const heic = Buffer.alloc(40);
    heic.writeUInt32BE(24, 0);
    heic.write('ftypheic', 4, 'ascii');
    heic.write('mif1heic', 16, 'ascii');
    expect((await upload(new Uint8Array(heic))).status).toBe(415);
  });

  it('422：损坏、过小', async () => {
    const good = await jpeg();
    const broken = Buffer.concat([good.subarray(0, 60), Buffer.alloc(500, 1)]);
    const r = await upload(new Uint8Array(broken));
    expect(r.status).toBe(422);
    expect(r.json).toMatchObject({ error: { code: 'IMAGE_UNREADABLE' } });
    const tiny = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#000' } })
      .png()
      .toBuffer();
    expect((await upload(new Uint8Array(tiny))).status).toBe(422);
  });

  it('403：跨站 Origin', async () => {
    const r = await upload(new Uint8Array(await jpeg()), { origin: 'https://evil.example' });
    expect(r.status).toBe(403);
  });

  it('提问带 imageId：LLM 收到图片，JEV 的 state 含 image，响应含 reading.image，落库', async () => {
    const img = await uploaded();
    resetMockStats();
    const r = await post(
      { question: '这两件哪件更适合明天面试？', requestId: uuid(), imageId: img.imageId },
      { 'x-real-ip': freshIp() },
    );
    expect(r.status).toBe(200);
    const reading = r.json.reading as Reading;
    expect(reading.image).toEqual({ width: img.width, height: img.height, alt: MOCK_IMAGE_ALT });
    expect(JSON.stringify(r.json)).not.toContain(img.imageId);
    expect(mockStats()).toMatchObject({ llmCalls: 1, llmImageCalls: 1, jevCalls: 1, jevImageCalls: 1 });
    const row = getDb()
      .prepare('SELECT image_id, image_alt, llm_json FROM readings WHERE id = ?')
      .get(reading.id) as { image_id: string; image_alt: string; llm_json: string };
    expect(row.image_id).toBe(img.imageId);
    expect(row.image_alt).toBe(MOCK_IMAGE_ALT);
    expect(JSON.parse(row.llm_json)).toMatchObject({
      hasImage: true,
      promptVersion: 'options-v1+vision-v3',
      visionPromptVersion: 'vision-v3',
    });
    expect(JSON.parse(row.llm_json).imageEn).toMatch(/mock/);
  });

  it('读图：thumb / full 的响应头、304；无图的答案与非法 size', async () => {
    const img = await uploaded();
    const reading = (
      await post(
        { question: '菜单上点哪道菜？', requestId: uuid(), imageId: img.imageId },
        { 'x-real-ip': freshIp() },
      )
    ).json.reading as Reading;
    const thumb = await image(reading.id);
    expect(thumb.status).toBe(200);
    expect(thumb.headers.get('content-type')).toBe('image/jpeg');
    expect(thumb.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(thumb.headers.get('cross-origin-resource-policy')).toBe('same-origin');
    expect(thumb.headers.get('x-robots-tag')).toBe('noindex');
    expect(thumb.headers.get('content-disposition')).toBe(`inline; filename="chunfeng-${reading.id}.jpg"`);
    const tm = await sharp(Buffer.from(await thumb.arrayBuffer())).metadata();
    expect(Math.max(tm.width!, tm.height!)).toBe(480);
    const full = await image(reading.id, '?size=full');
    const fm = await sharp(Buffer.from(await full.arrayBuffer())).metadata();
    expect([fm.width, fm.height]).toEqual([img.width, img.height]);
    const etag = thumb.headers.get('etag')!;
    expect(etag).toMatch(/^"[0-9a-f]{16}-thumb"$/);
    expect(full.headers.get('etag')).not.toBe(etag);
    const again = await image(reading.id, '', { 'if-none-match': etag });
    expect(again.status).toBe(304);
    expect((await image(reading.id, '?size=huge')).status).toBe(400);

    const plain = (await post({ question: '要不要去跑步？', requestId: uuid() }, { 'x-real-ip': freshIp() }))
      .json.reading as Reading;
    expect(plain.image).toBeUndefined();
    expect((await image(plain.id)).status).toBe(404);
    expect((await image('../../../etc')).status).toBe(404);
    expect((await image('ZZZZZZZZZZZZ')).status).toBe(404);
  });

  it('再翻一次沿用图片；重放不重复调用', async () => {
    const img = await uploaded();
    const first = (
      await post(
        { question: '两份 offer 选哪个？', requestId: uuid(), imageId: img.imageId },
        { 'x-real-ip': freshIp() },
      )
    ).json.reading as Reading;
    resetMockStats();
    const requestId = uuid();
    const regen = await post(
      { question: '两份 offer 选哪个？', requestId, regenOf: first.id },
      { 'x-real-ip': freshIp() },
    );
    const second = regen.json.reading as Reading;
    expect(second.regenOf).toBe(first.id);
    expect(second.image).toEqual(first.image);
    expect(mockStats()).toMatchObject({ llmImageCalls: 1, jevImageCalls: 1 });
    // 同一 requestId 重放（不带 imageId，沿用规则相同）
    resetMockStats();
    const replay = await post(
      { question: '两份 offer 选哪个？', requestId, regenOf: first.id },
      { 'x-real-ip': freshIp() },
    );
    expect(replay.json).toEqual(regen.json);
    expect(mockStats()).toMatchObject({ llmCalls: 0 });
  });

  it('同一 requestId 换了图 → 400；imageId 格式不对 → 400；不存在 → IMAGE_NOT_FOUND', async () => {
    const a = await uploaded();
    const b = await uploaded();
    const requestId = uuid();
    await post({ question: '哪件好看？', requestId, imageId: a.imageId }, { 'x-real-ip': freshIp() });
    const swapped = await post(
      { question: '哪件好看？', requestId, imageId: b.imageId },
      { 'x-real-ip': freshIp() },
    );
    expect(swapped.status).toBe(400);
    expect(swapped.json).toMatchObject({ error: { code: 'BAD_REQUEST' } });
    const noImage = await post({ question: '哪件好看？', requestId }, { 'x-real-ip': freshIp() });
    expect(noImage.status).toBe(400);

    const bad = await post(
      { question: '哪件好看？', requestId: uuid(), imageId: '../x' },
      { 'x-real-ip': freshIp() },
    );
    expect(bad.json).toMatchObject({ error: { code: 'BAD_REQUEST' } });
    const missing = await post(
      { question: '哪件好看？', requestId: uuid(), imageId: 'NoSuchImage00000' },
      { 'x-real-ip': freshIp() },
    );
    expect(missing.status).toBe(400);
    expect(missing.json).toMatchObject({ error: { code: 'IMAGE_NOT_FOUND', retryable: false } });
  });

  it('风控拦截（llm:filter）→ refused，不落库；novision → SERVICE_MISCONFIGURED', async () => {
    const img = await uploaded();
    const before = count('readings');
    setMockFail('llm:filter:1');
    const r = await post(
      { question: '这张图怎么选？', requestId: uuid(), imageId: img.imageId },
      { 'x-real-ip': freshIp() },
    );
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ status: 'refused', message: '' });
    expect(count('readings')).toBe(before);
    expect(mockStats().llmCalls).toBe(1); // 不重试

    setMockFail('llm:novision:1');
    const n = await post(
      { question: '这张图怎么选？', requestId: uuid(), imageId: img.imageId },
      { 'x-real-ip': freshIp() },
    );
    expect(n.status).toBe(503);
    expect(n.json).toMatchObject({ error: { code: 'SERVICE_MISCONFIGURED', retryable: false } });
  });

  it('文字提问同样适用风控规则', async () => {
    setMockFail('llm:filter:1');
    const r = await post({ question: '周末去哪儿玩？', requestId: uuid() }, { 'x-real-ip': freshIp() });
    expect(r.json).toEqual({ status: 'refused', message: '' });
  });

  it('孤儿清理：超过 24 h 且无引用的删除，被引用的保留', async () => {
    const used = await uploaded();
    const orphan = await uploaded();
    const fresh = await uploaded();
    await post(
      { question: '选哪一个？', requestId: uuid(), imageId: used.imageId },
      { 'x-real-ip': freshIp() },
    );
    const old = Date.now() - 25 * 60 * 60 * 1000;
    getDb()
      .prepare('UPDATE images SET created_at = ? WHERE id IN (?, ?)')
      .run(old, used.imageId, orphan.imageId);
    const removed = await runOrphanImageCleanup();
    expect(removed).toBeGreaterThanOrEqual(1);
    const exists = (id: string) => existsSync(join(imageDir, id.slice(0, 2), `${id}.jpg`));
    expect(exists(orphan.imageId)).toBe(false);
    expect(exists(used.imageId)).toBe(true);
    expect(exists(fresh.imageId)).toBe(true);
  });

  it('429：上传限流与提问分开计数', async () => {
    process.env.UPLOAD_RATE_LIMIT_PER_MIN = '1';
    const { resetServerStateForTests } = await import('@/server/reading/state');
    resetServerStateForTests();
    setSharpAvailableForTests(undefined);
    const ip = freshIp();
    const body = new Uint8Array(await jpeg());
    expect((await upload(body, { 'x-real-ip': ip })).status).toBe(201);
    const limited = await upload(body, { 'x-real-ip': ip });
    expect(limited.status).toBe(429);
    expect(limited.res.headers.get('retry-after')).toBeTruthy();
    // 提问不受影响
    expect((await post({ question: '要不要早点睡？', requestId: uuid() }, { 'x-real-ip': ip })).status).toBe(
      200,
    );
    process.env.UPLOAD_RATE_LIMIT_PER_MIN = '1000';
    resetServerStateForTests();
  });
});

describe('LLM_VISION=false（默认）', () => {
  let env: ReturnType<typeof setupEnv>;
  beforeAll(() => {
    delete process.env.LLM_VISION;
    env = setupEnv();
  });
  afterAll(() => env.cleanup());

  it('上传与带图提问都返回 VISION_DISABLED；health 为 off', async () => {
    const r = await upload(new Uint8Array(await jpeg()));
    expect(r.status).toBe(400);
    expect(r.json).toMatchObject({ error: { code: 'VISION_DISABLED', retryable: false } });
    const q = await post(
      { question: '哪件好看？', requestId: uuid(), imageId: 'Qm7xK2pT9cHd4Ls8' },
      { 'x-real-ip': freshIp() },
    );
    expect(q.json).toMatchObject({ error: { code: 'VISION_DISABLED' } });
    expect(await (await health()).json()).toMatchObject({ vision: 'off' });
  });

  it('关闭开关后，已有答案的图片照常可读；再翻一次带图答案 → VISION_DISABLED', async () => {
    // 直接写入一条带图答案（模拟开关开启时产生的数据）
    process.env.LLM_VISION = 'true';
    const { resetConfigForTests } = await import('@/server/config');
    resetConfigForTests();
    process.env.IMAGE_DIR = join(env.dir, 'images');
    resetConfigForTests();
    const img = (await upload(new Uint8Array(await jpeg()))).json as unknown as UploadImageResponse;
    const reading = (
      await post(
        { question: '哪件好看？', requestId: uuid(), imageId: img.imageId },
        { 'x-real-ip': freshIp() },
      )
    ).json.reading as Reading;
    delete process.env.LLM_VISION;
    resetConfigForTests();

    expect((await image(reading.id)).status).toBe(200);
    const regen = await post(
      { question: '哪件好看？', requestId: uuid(), regenOf: reading.id },
      { 'x-real-ip': freshIp() },
    );
    expect(regen.json).toMatchObject({ error: { code: 'VISION_DISABLED' } });
    delete process.env.IMAGE_DIR;
  });

  it('sharp 不可用时：vision 为 unavailable，上传返回 VISION_DISABLED', async () => {
    process.env.LLM_VISION = 'true';
    const { resetConfigForTests } = await import('@/server/config');
    resetConfigForTests();
    setSharpAvailableForTests(false);
    expect(await (await health()).json()).toMatchObject({ vision: 'unavailable' });
    expect((await upload(new Uint8Array(await jpeg()))).json).toMatchObject({
      error: { code: 'VISION_DISABLED' },
    });
    setSharpAvailableForTests(undefined);
    delete process.env.LLM_VISION;
    resetConfigForTests();
  });
});
