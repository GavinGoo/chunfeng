import { existsSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GET as shareImage } from '@/app/api/readings/[id]/share-image/route';
import type { Reading } from '@/lib/shared/types';
import { readChunks, readTextChunks } from '@/server/share/metadata';
import { BASE, freshIp, HOST, post, setupEnv, uuid } from './helpers';

let env: ReturnType<typeof setupEnv>;
beforeAll(() => {
  env = setupEnv();
});
afterAll(() => env.cleanup());

async function create(question: string): Promise<Reading> {
  const { json } = await post({ question, requestId: uuid() }, { 'x-real-ip': freshIp() });
  expect(json.status).toBe('ok');
  return json.reading as Reading;
}

/** 分享弹层里的 <img>：浏览器带上 Host 与 Sec-Fetch-Site: same-origin */
const SAME_SITE = { host: HOST, 'sec-fetch-site': 'same-origin' };

function call(id: string, headers: Record<string, string> = SAME_SITE, query = '') {
  return shareImage(new Request(`${BASE}/api/readings/${id}/share-image${query}`, { headers }), {
    params: Promise.resolve({ id }),
  });
}

describe('GET /api/readings/[id]/share-image（12 §3.1）', () => {
  it('返回 1080×1620 的 PNG，带隐式标识；第二次命中磁盘缓存；If-None-Match → 304', async () => {
    const reading = await create('工作三年了，要不要跳槽去创业公司？🌸 English mixed 繁體');
    const t0 = performance.now();
    const res = await call(reading.id);
    const firstMs = performance.now() - t0;
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('cache-control')).toBe('public, no-cache');
    const etag = res.headers.get('etag');
    expect(etag).toMatch(new RegExp(`^"${reading.id}-`));
    const png = Buffer.from(await res.arrayBuffer());
    const ihdr = readChunks(png)[0]!;
    expect(ihdr.type).toBe('IHDR');
    expect(ihdr.data.readUInt32BE(0)).toBe(1080);
    expect(ihdr.data.readUInt32BE(4)).toBe(1620);
    const text = readTextChunks(png);
    expect(JSON.parse(text.AIGC ?? '{}')).toMatchObject({ Label: '1', ProduceID: reading.id });
    expect(text.Software).toBe('chunfeng share-image');

    // 一篇答案一张图（D35）：文件名就是 {id}.png，没有版本与域名；也没有残留临时文件
    const dir = join(env.dir, 'share-cache');
    const files = readdirSync(dir);
    expect(files).toContain(`${reading.id}.png`);
    expect(files.filter((f) => f.startsWith(reading.id))).toEqual([`${reading.id}.png`]);
    expect(files.filter((f) => f.endsWith('.tmp'))).toEqual([]);

    const t1 = performance.now();
    const again = await call(reading.id, {}, '?r=2');
    const cachedMs = performance.now() - t1;
    expect(again.status).toBe(200);
    expect(again.headers.get('etag')).toBe(etag);
    expect(Buffer.from(await again.arrayBuffer()).equals(png)).toBe(true);
    expect(cachedMs).toBeLessThan(firstMs);

    const notModified = await call(reading.id, { 'if-none-match': etag! });
    expect(notModified.status).toBe(304);
    expect(await notModified.text()).toBe('');
  });

  it('并发请求同一张图只渲染一次，结果一致', async () => {
    const reading = await create('周末去海边还是进山？');
    const [a, b] = await Promise.all([call(reading.id), call(reading.id)]);
    const [ba, bb] = await Promise.all([a.arrayBuffer(), b.arrayBuffer()]);
    expect(Buffer.from(ba).equals(Buffer.from(bb))).toBe(true);
  });

  it('首张图固化：之后的请求无论是哪个域名、哪个 UA，都拿到同一张图、同一个文件', async () => {
    const reading = await create('要不要换个城市生活？');
    const dir = join(env.dir, 'share-cache');

    // 第一次来自本站（浏览器加载分享弹层的 <img>）：Sec-Fetch-Site: same-origin
    const first = await call(reading.id, {
      'sec-fetch-site': 'same-origin',
      host: '192.168.1.5:3000',
      'x-forwarded-proto': 'http',
    });
    const png = Buffer.from(await first.arrayBuffer());
    expect(first.status).toBe(200);

    // 之后换域名、换 UA（爬虫 / 直接 GET）都命中同一个文件，不再渲染、不再改动
    const later: Record<string, string>[] = [
      { host: 'book.example', 'x-forwarded-proto': 'https' },
      { host: 'evil.example' },
      { referer: 'https://other.example/x', host: 'other.example' },
    ];
    for (const headers of later) {
      const res = await call(reading.id, headers);
      expect(res.status).toBe(200);
      expect(res.headers.get('etag')).toBe(first.headers.get('etag'));
      expect(Buffer.from(await res.arrayBuffer()).equals(png)).toBe(true);
    }
    expect(readdirSync(dir).filter((f) => f.startsWith(reading.id))).toEqual([`${reading.id}.png`]);
  });

  it('每次回源校验：304 之后删掉磁盘上的图，下一次请求重新渲染（D37）', async () => {
    const reading = await create('删了图以后还能重新生成吗？');
    const file = join(env.dir, 'share-cache', `${reading.id}.png`);

    const first = await call(reading.id);
    const etag = first.headers.get('etag');
    const ihdr = readChunks(Buffer.from(await first.arrayBuffer()))[0]!;
    expect(ihdr.data.readUInt32BE(0)).toBe(1080);

    // 浏览器存的还是旧副本，但每次使用前都会回来问一次：命中 → 304，不重传
    const revalidated = await call(reading.id, { 'if-none-match': etag! });
    expect(revalidated.status).toBe(304);

    // 人工删掉 → 下一次请求（哪怕是带着同一个 If-None-Match 的老浏览器）拿到重新渲染的图
    rmSync(file);
    const again = await call(reading.id, { ...SAME_SITE, 'if-none-match': etag! });
    expect(again.status).toBe(200);
    const png = Buffer.from(await again.arrayBuffer());
    expect(readChunks(png)[0]!.data.readUInt32BE(4)).toBe(1620);
    expect(existsSync(file)).toBe(true);
  });

  it('非本站请求照常渲染但不落盘、no-store；之后的本站请求才落盘（D45）', async () => {
    const reading = await create('非本站先来，会不会把域名钉死？');
    const file = join(env.dir, 'share-cache', `${reading.id}.png`);

    // 爬虫 / 直接 GET / 地址栏打开：没有 Sec-Fetch-Site 与 Referer，或明确不是 same-origin
    const strangers: Record<string, string>[] = [
      { host: 'book.example', 'x-forwarded-proto': 'https' },
      { host: HOST, 'sec-fetch-site': 'none' },
      { host: HOST, 'sec-fetch-site': 'cross-site' },
      { host: HOST, referer: 'https://other.example/x' },
    ];
    for (const headers of strangers) {
      const res = await call(reading.id, headers);
      expect(res.status).toBe(200);
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect(res.headers.get('etag')).toBeNull();
      expect(readChunks(Buffer.from(await res.arrayBuffer()))[0]!.data.readUInt32BE(0)).toBe(1080);
      expect(existsSync(file)).toBe(false);
    }

    // 本站请求（含没有 Sec-Fetch-Site、只有同域 Referer 的老浏览器）才写入磁盘
    const own = await call(reading.id, { host: HOST, referer: `${BASE}/a/${reading.id}` });
    expect(own.status).toBe(200);
    expect(own.headers.get('cache-control')).toBe('public, no-cache');
    const png = Buffer.from(await own.arrayBuffer());
    expect(existsSync(file)).toBe(true);

    // 落盘之后，非本站请求也命中这张图
    const later = await call(reading.id, { host: 'book.example' });
    expect(later.headers.get('etag')).toBe(own.headers.get('etag'));
    expect(Buffer.from(await later.arrayBuffer()).equals(png)).toBe(true);
  });

  it('Host 缺失或非法且没有缓存 → 400，不渲染、不落盘', async () => {
    const reading = await create('没有 Host 的请求怎么办？');
    const file = join(env.dir, 'share-cache', `${reading.id}.png`);
    for (const headers of [{ 'sec-fetch-site': 'same-origin' }, { ...SAME_SITE, host: 'evil.example/x' }]) {
      const res = await call(reading.id, headers);
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe('BAD_REQUEST');
    }
    expect(existsSync(file)).toBe(false);
  });

  it('未知 id → 404 NOT_FOUND；非法 id → 404', async () => {
    const res = await call('AAAAAAAAAAAA');
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('NOT_FOUND');
    expect((await call('bad id')).status).toBe(404);
  });
});
