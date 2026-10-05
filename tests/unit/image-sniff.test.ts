import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { sniffImage } from '@/server/image/sniff';

const raw = { raw: { width: 20, height: 20, channels: 3 as const } };
const pixels = Buffer.alloc(20 * 20 * 3, 128);
const make = (f: 'jpeg' | 'png' | 'webp' | 'gif' | 'avif' | 'tiff') =>
  sharp(pixels, raw).toFormat(f).toBuffer();

function ftyp(major: string, compat: string[]): Buffer {
  const size = 16 + compat.length * 4;
  const b = Buffer.alloc(size + 8);
  b.writeUInt32BE(size, 0);
  b.write('ftyp', 4, 'ascii');
  b.write(major, 8, 'ascii');
  compat.forEach((c, i) => {
    b.write(c, 16 + i * 4, 'ascii');
  });
  return b;
}

describe('sniffImage（15 §5.2 第 5 步）', () => {
  it('JPEG / PNG / WebP / GIF / AVIF 通过', async () => {
    expect(sniffImage(await make('jpeg'))).toBe('jpeg');
    expect(sniffImage(await make('png'))).toBe('png');
    expect(sniffImage(await make('webp'))).toBe('webp');
    expect(sniffImage(await make('gif'))).toBe('gif');
    expect(sniffImage(await make('avif'))).toBe('avif');
    expect(sniffImage(ftyp('mif1', ['mif1', 'avif', 'miaf']))).toBe('avif');
  });

  it('HEIC、SVG、TIFF、PDF、文本、空文件被拒', async () => {
    expect(sniffImage(ftyp('heic', ['mif1', 'heic']))).toBeNull();
    expect(sniffImage(ftyp('heix', ['mif1', 'heix']))).toBeNull();
    expect(sniffImage(ftyp('mif1', ['mif1', 'heic']))).toBeNull();
    expect(sniffImage(ftyp('mp42', ['isom']))).toBeNull();
    expect(
      sniffImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><image href="http://x/y"/></svg>')),
    ).toBeNull();
    expect(sniffImage(Buffer.from('<?xml version="1.0"?><svg></svg>'))).toBeNull();
    expect(sniffImage(await make('tiff'))).toBeNull();
    expect(sniffImage(Buffer.from('%PDF-1.7\n1 0 obj'))).toBeNull();
    expect(sniffImage(Buffer.from('hello world, not an image'))).toBeNull();
    expect(sniffImage(Buffer.alloc(0))).toBeNull();
    expect(sniffImage(Buffer.from([0xff, 0xd8]))).toBeNull();
  });
});
