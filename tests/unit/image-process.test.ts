import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterAll, describe, expect, it } from 'vitest';
import { FULL_MAX_EDGE, FULL_MAX_PIXELS, THUMB_MAX_EDGE } from '@/lib/shared/image';
import { AppError } from '@/server/http/errors';
import { processImage } from '@/server/image/process';
import { imagePath, readImage, removeImage, writeImage } from '@/server/image/store';

// 测试样图由测试代码现场生成（15 §16.1）

function solid(width: number, height: number, background = '#1f5f3a') {
  return sharp({ create: { width, height, channels: 3, background } });
}

describe('processImage（15 §5.3）', () => {
  it('按 EXIF 方向摆正；移除 EXIF / GPS / XMP / ICC', async () => {
    const input = await solid(400, 200)
      .jpeg()
      .withMetadata({ orientation: 6 })
      .withExif({ IFD0: { Make: 'TestCam' }, IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '31/1 12/1 0/1' } })
      .withXmp(
        '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"/></x:xmpmeta>',
      )
      .toBuffer();
    expect((await sharp(input).metadata()).exif).toBeDefined();

    const out = await processImage(input, 'jpeg');
    expect(out.width).toBe(200);
    expect(out.height).toBe(400);
    for (const buf of [out.full, out.thumb]) {
      const m = await sharp(buf).metadata();
      expect(m.format).toBe('jpeg');
      expect(m.exif).toBeUndefined();
      expect(m.xmp).toBeUndefined();
      expect(m.icc).toBeUndefined();
      expect(m.orientation).toBeUndefined();
      expect(buf.includes(Buffer.from('TestCam'))).toBe(false);
    }
    expect(out.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(out.sourceFormat).toBe('jpeg');
  });

  it('透明 PNG 铺白', async () => {
    const input = await sharp({
      create: { width: 32, height: 32, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .png()
      .toBuffer();
    const out = await processImage(input, 'png');
    const { data } = await sharp(out.full).raw().toBuffer({ resolveWithObject: true });
    expect(Math.min(...data)).toBeGreaterThan(245);
  });

  it('长边与像素上限；thumb 长边 ≤ 480', async () => {
    const out = await processImage(await solid(4000, 3000).jpeg().toBuffer(), 'jpeg');
    expect(Math.max(out.width, out.height)).toBeLessThanOrEqual(FULL_MAX_EDGE);
    expect(out.width * out.height).toBeLessThanOrEqual(FULL_MAX_PIXELS);
    expect(Math.max(out.thumbWidth, out.thumbHeight)).toBe(THUMB_MAX_EDGE);
    const wide = await processImage(await solid(6000, 300).png().toBuffer(), 'png');
    expect(wide.width).toBe(FULL_MAX_EDGE);
    const small = await processImage(await solid(100, 60).webp().toBuffer(), 'webp');
    expect([small.width, small.height, small.thumbWidth]).toEqual([100, 60, 100]);
  });

  it('GIF 只取第一帧', async () => {
    const out = await processImage(await solid(64, 64).gif().toBuffer(), 'gif');
    expect([out.width, out.height]).toEqual([64, 64]);
  });

  it('超过 40 MP、过小与损坏的图被拒（IMAGE_UNREADABLE）', async () => {
    const huge = await sharp({ create: { width: 8000, height: 5001, channels: 3, background: '#000' } })
      .png({ compressionLevel: 1 })
      .toBuffer();
    const tiny = await solid(10, 200).png().toBuffer();
    const jpeg = await solid(64, 64).jpeg().toBuffer();
    const broken = Buffer.concat([jpeg.subarray(0, 40), Buffer.alloc(200, 0x11)]);
    for (const [buf, f] of [
      [huge, 'png'],
      [tiny, 'png'],
      [broken, 'jpeg'],
    ] as const) {
      const e = await processImage(buf, f).catch((x: unknown) => x);
      expect(e).toBeInstanceOf(AppError);
      expect((e as AppError).code).toBe('IMAGE_UNREADABLE');
    }
  }, 30_000);
});

describe('image store（15 §6.2）', () => {
  const dir = mkdtempSync(join(tmpdir(), 'chunfeng-img-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('路径只由合法 id 拼成：两级目录', () => {
    expect(imagePath('Qm7xK2pT9cHd4Ls8', 'full', dir)).toBe(join(dir, 'Qm', 'Qm7xK2pT9cHd4Ls8.jpg'));
    expect(imagePath('Qm7xK2pT9cHd4Ls8', 'thumb', dir)).toBe(join(dir, 'Qm', 'Qm7xK2pT9cHd4Ls8.t.jpg'));
    expect(() => imagePath('../../etc/passwd', 'full', dir)).toThrow();
    expect(() => imagePath('Qm7xK2pT9cHd4Ls8/..', 'full', dir)).toThrow();
  });

  it('写入、读取、删除；不留临时文件', async () => {
    const img = await processImage(await solid(64, 48).jpeg().toBuffer(), 'jpeg');
    const id = 'AbCdEfGh12345678';
    await writeImage(id, img, dir);
    expect(readdirSync(join(dir, 'Ab')).sort()).toEqual([`${id}.jpg`, `${id}.t.jpg`]);
    expect((await readImage(id, 'full', dir))?.equals(img.full)).toBe(true);
    expect((await readImage(id, 'thumb', dir))?.equals(img.thumb)).toBe(true);
    expect(await readImage('../../x', 'full', dir)).toBeNull();
    await removeImage(id, dir);
    expect(await readImage(id, 'full', dir)).toBeNull();
    expect(readdirSync(join(dir, 'Ab'))).toEqual([]);
  });
});
