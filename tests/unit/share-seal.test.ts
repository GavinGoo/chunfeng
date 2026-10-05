import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { readChunks } from '@/server/share/metadata';
import { APPLE_ART_SIZE, APPLE_SIZE, SEAL_ART_SIZE, SEAL_SIZE } from '@/server/share/seal';

// 06 §5.1：两份印章 PNG 都由 `pnpm build:seal` 从同一个 Seal 组件生成。
const SEAL_FILE = path.join(process.cwd(), 'public', 'seal.png');
const APPLE_FILE = path.join(process.cwd(), 'public', 'apple-touch-icon.png');

interface Pixels {
  width: number;
  height: number;
  channels: number;
  data: Buffer;
}

async function pixels(file: string): Promise<Pixels> {
  const sharp = (await import('sharp')).default;
  const { data, info } = await sharp(readFileSync(file))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, channels: info.channels, data };
}

function at(p: Pixels, x: number, y: number): number[] {
  const i = (y * p.width + x) * p.channels;
  return [...p.data.subarray(i, i + p.channels)];
}

describe('印章 PNG（06 §5.1）', () => {
  it('public/seal.png：SEAL_SIZE 的正方形 RGBA，四角透明（og:image 与标签页 icon，D36、D39）', async () => {
    const png = readFileSync(SEAL_FILE);
    const ihdr = readChunks(png)[0]!;
    expect(ihdr.type).toBe('IHDR');
    expect(ihdr.data.readUInt32BE(0)).toBe(SEAL_SIZE);
    expect(ihdr.data.readUInt32BE(4)).toBe(SEAL_SIZE);
    expect(ihdr.data[9]).toBe(6); // 颜色类型 6 = RGBA
    expect(SEAL_ART_SIZE).toBeLessThan(SEAL_SIZE); // 印章与画布之间留白

    const p = await pixels(SEAL_FILE);
    for (const [x, y] of [
      [0, 0],
      [p.width - 1, 0],
      [0, p.height - 1],
      [p.width - 1, p.height - 1],
    ] as const) {
      expect(at(p, x, y)[3]).toBe(0); // 透明底；重新生成时别把底色带回来
    }
    expect(at(p, p.width >> 1, p.height >> 1)[3]).toBe(255); // 印章本身不透明
  });

  it('public/apple-touch-icon.png：APPLE_SIZE、铺满纸色底、完全不透明（iOS 主屏，D42）', async () => {
    const png = readFileSync(APPLE_FILE);
    const ihdr = readChunks(png)[0]!;
    expect(ihdr.data.readUInt32BE(0)).toBe(APPLE_SIZE);
    expect(ihdr.data.readUInt32BE(4)).toBe(APPLE_SIZE);
    expect(APPLE_ART_SIZE).toBeLessThan(APPLE_SIZE);

    const p = await pixels(APPLE_FILE);
    for (const [x, y] of [
      [0, 0],
      [p.width - 1, 0],
      [0, p.height - 1],
      [p.width - 1, p.height - 1],
    ] as const) {
      // iOS 会把透明的部分垫成黑色，所以四个角必须是不透明的纸色
      expect(at(p, x, y)).toEqual([244, 236, 220, 255]);
    }
    expect(at(p, p.width >> 1, p.height >> 1)).toEqual([163, 59, 42, 255]); // 印章中心
  });
});
