import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { POST as postUpload } from '@/app/api/uploads/route';
import { photoTilt } from '@/components/answer/photoStyle';
import type { UploadImageResponse } from '@/lib/shared/image';
import type { Reading } from '@/lib/shared/types';
import { imagePath } from '@/server/image/store';
import { getDb } from '@/server/reading/db';
import { loadSharePhoto, renderSharePng } from '@/server/share/render';
import { photoLayoutFor, toShareModel } from '@/server/share/template';
import { BASE, freshIp, HOST, post, setupEnv, uuid } from './helpers';

// 带图答案的分享图（15 §12、§16.2）

let env: ReturnType<typeof setupEnv>;
beforeAll(() => {
  env = setupEnv({ LLM_VISION: 'true' });
  process.env.IMAGE_DIR = join(env.dir, 'images');
});
afterAll(() => {
  delete process.env.IMAGE_DIR;
  delete process.env.LLM_VISION;
  env.cleanup();
});

async function withPhoto(
  width: number,
  height: number,
  question = '这两件哪件更适合明天面试？',
): Promise<Reading> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <rect width="100%" height="100%" fill="#7aa0b8"/><rect x="10%" y="10%" width="35%" height="80%" fill="#1f5f3a"/>
    <rect x="55%" y="10%" width="35%" height="80%" fill="#d8c7a0"/></svg>`;
  const body = await sharp(Buffer.from(svg)).jpeg().toBuffer();
  const up = await postUpload(
    new Request(`${BASE}/api/uploads`, {
      method: 'POST',
      headers: { 'content-type': 'image/jpeg', origin: BASE, host: HOST, 'x-real-ip': freshIp() },
      body: new Uint8Array(body),
    }),
  );
  expect(up.status).toBe(201);
  const { imageId } = (await up.json()) as UploadImageResponse;
  const r = await post({ question, requestId: uuid(), imageId }, { 'x-real-ip': freshIp() });
  return r.json.reading as Reading;
}

async function size(png: Buffer) {
  const m = await sharp(png).metadata();
  return [m.width, m.height];
}

/** 两张图差异像素的比例（粗略） */
async function diffRatio(a: Buffer, b: Buffer): Promise<number> {
  const ra = await sharp(a).removeAlpha().raw().toBuffer();
  const rb = await sharp(b).removeAlpha().raw().toBuffer();
  let diff = 0;
  for (let i = 0; i < ra.length; i += 3) {
    if (
      Math.abs(ra[i]! - rb[i]!) + Math.abs(ra[i + 1]! - rb[i + 1]!) + Math.abs(ra[i + 2]! - rb[i + 2]!) >
      30
    )
      diff++;
  }
  return diff / (ra.length / 3);
}

describe('分享图：带图版式', () => {
  it('宽 / 高 / 方图都是 1080×1620，与无图版式不同；删除文件后按兜底版式渲染', async () => {
    const plainReading = (
      await post({ question: '这两件哪件更适合明天面试？', requestId: uuid() }, { 'x-real-ip': freshIp() })
    ).json.reading as Reading;
    const plain = await renderSharePng(plainReading, BASE);
    const out = process.env.SHARE_SAMPLE_DIR;
    let minPhotoDiff = 1;
    for (const [w, h, name] of [
      [2400, 400, 'wide'],
      [400, 2400, 'tall'],
      [1200, 1200, 'square'],
    ] as const) {
      const reading = await withPhoto(w, h);
      const t0 = performance.now();
      const png = await renderSharePng(reading, BASE);
      const ms = performance.now() - t0;
      expect(await size(png)).toEqual([1080, 1620]);
      const d = await diffRatio(png, plain);
      expect(d).toBeGreaterThan(0.02);
      minPhotoDiff = Math.min(minPhotoDiff, d);
      if (out) writeFileSync(join(out, `share-${name}.png`), png);
      expect(ms).toBeLessThan(5000);
    }

    // 删除图片文件 → 兜底版式（不报错）
    const reading = await withPhoto(800, 600);
    const imageId = (
      getDb().prepare('SELECT image_id FROM readings WHERE id = ?').get(reading.id) as {
        image_id: string;
      }
    ).image_id;
    rmSync(imagePath(imageId, 'full'));
    const fallback = await renderSharePng(reading, BASE);
    expect(await size(fallback)).toEqual([1080, 1620]);
    if (out) writeFileSync(join(out, 'share-fallback.png'), fallback);
    // 兜底版式接近无图版式（只多一行标注），与带图版式的差异明显更小
    expect(await diffRatio(fallback, plain)).toBeLessThan(minPhotoDiff / 2);
  }, 60_000);
});

describe('分享图：相片的倾斜', () => {
  it('与答案页横屏的倾斜角相同，且倾斜绝对值 ≥ 1°', async () => {
    const reading = await withPhoto(1200, 900);
    const model = toShareModel(reading, await loadSharePhoto(reading));
    expect(model.photoTilt).toBe(photoTilt(reading.id, 'spread'));
    expect(Math.abs(model.photoTilt!)).toBeGreaterThanOrEqual(1);
  });
});

describe('分享图：提问区版式（15 §12）', () => {
  it('宽高比 ≤ 2:1 左文右图，超过 2:1 相片在提问下方；相片不超过各自的相片框', async () => {
    expect(photoLayoutFor(1600, 800)).toBe('side');
    expect(photoLayoutFor(1601, 800)).toBe('below');
    expect(photoLayoutFor(400, 2400)).toBe('side');
    for (const [w, h, layout, box] of [
      [1170, 2532, 'side', 322],
      [1600, 900, 'side', 322],
      [2400, 400, 'below', 862],
    ] as const) {
      const reading = await withPhoto(w, h);
      const { photo } = await loadSharePhoto(reading);
      expect(photo?.layout).toBe(layout);
      expect(photo!.width).toBeLessThanOrEqual(box);
      expect(photo!.height).toBeLessThanOrEqual(layout === 'side' ? 322 : 242);
    }
  });
});
