// 魔数白名单（15 §5.2 第 5 步）。以文件头为准，不信任 Content-Type。
// SVG 必须在这里拒绝：sharp 自带 librsvg，能渲染 SVG，而 SVG 可以引用外部资源。

export type SniffedFormat = 'jpeg' | 'png' | 'webp' | 'gif' | 'avif';

function ascii(bytes: Uint8Array, start: number, len: number): string {
  let s = '';
  for (let i = start; i < start + len && i < bytes.length; i++) s += String.fromCharCode(bytes[i]!);
  return s;
}

/** AVIF 的 ftyp 品牌（avif 为静态图，avis 为图像序列）；HEIC 的 heic / heix / mif1 等不在其中 */
const AVIF_BRANDS = new Set(['avif', 'avis']);

export function sniffImage(bytes: Uint8Array): SniffedFormat | null {
  if (bytes.length < 12) return null;
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';
  if (
    bytes[0] === 0x89 &&
    ascii(bytes, 1, 3) === 'PNG' &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  )
    return 'png';
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') return 'webp';
  const gif = ascii(bytes, 0, 6);
  if (gif === 'GIF87a' || gif === 'GIF89a') return 'gif';
  if (ascii(bytes, 4, 4) === 'ftyp') {
    // ISO BMFF：主品牌在 8–11，兼容品牌从 16 开始，直到 box 结束
    const boxSize = ((bytes[0]! << 24) | (bytes[1]! << 16) | (bytes[2]! << 8) | bytes[3]!) >>> 0;
    const major = ascii(bytes, 8, 4);
    if (AVIF_BRANDS.has(major)) return 'avif';
    // 兼容品牌里有 avif、但主品牌是 HEIC 系列的，按 HEIC 处理（sharp 预编译包解不了 HEVC）
    if (/^(hei|hev|msf1)/.test(major)) return null;
    const end = Math.min(bytes.length, boxSize >= 16 ? boxSize : 16);
    for (let i = 16; i + 4 <= end; i += 4) {
      if (AVIF_BRANDS.has(ascii(bytes, i, 4))) return 'avif';
    }
    return null;
  }
  return null;
}
