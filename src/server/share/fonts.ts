import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

// 分享图字体（12 §3.2）：
// - 进程内首次使用时把静态字体读入内存（之后常驻），并解析 cmap 得到每个字体覆盖的码位；
// - 每次渲染前用 subset-font（HarfBuzz）按本次文字做子集，得到几十 KB 的 OTF/TTF 再交给 satori；
// - 小型 LRU 缓存子集结果（同一张图重试、固定文案的印章等）。
//
// 字体分工与网页一致（06 §3.2 的「Chunfeng UI」+ Source Serif 4）：
// 汉字、全角标点、弯引号等交给思源宋体；拉丁字母、数字、半角符号交给 Source Serif 4。
// satori 按 fontFamily 的顺序逐字回退，所以思源宋体的子集里只放「该由它显示的字」。
// 印章用书名子集字体「Chunfeng Title」（玄宗体，D20）：构建时已是子集，这里不再子集化。

// subset-font 没有类型声明，这里只声明用到的签名
type SubsetFont = (
  font: Buffer,
  text: string,
  options: { targetFormat: 'sfnt'; noHinting?: boolean },
) => Promise<Buffer>;
const subsetFont = createRequire(import.meta.url)('subset-font') as SubsetFont;

export type ShareWeight = 400 | 600;

export const CJK_FAMILY = 'Noto Serif SC';
export const LATIN_FAMILY = 'Source Serif 4';
export const TITLE_FAMILY = 'Chunfeng Title';

export interface SatoriFont {
  name: string;
  data: ArrayBuffer;
  weight: ShareWeight;
  style: 'normal';
}

interface LoadedFont {
  data: Buffer;
  cmap: Set<number>;
}

const FILES = {
  cjk400: 'NotoSerifSC-Regular.otf',
  cjk600: 'NotoSerifSC-SemiBold.otf',
  latin400: 'SourceSerif4-Regular.ttf',
  latin600: 'SourceSerif4-Semibold.ttf',
  title: 'ChunfengTitle.otf',
} as const;
type FontKey = keyof typeof FILES;

export function fontsDir(): string {
  return path.join(process.cwd(), 'assets/fonts');
}

// ---------- cmap 解析（format 4 / 12） ----------

/** 解析 sfnt 的 cmap，返回字体覆盖的全部 Unicode 码位 */
export function parseCmap(buf: Buffer): Set<number> {
  const out = new Set<number>();
  const numTables = buf.readUInt16BE(4);
  let cmapOffset = -1;
  for (let i = 0; i < numTables; i++) {
    const rec = 12 + i * 16;
    if (buf.toString('latin1', rec, rec + 4) === 'cmap') {
      cmapOffset = buf.readUInt32BE(rec + 8);
      break;
    }
  }
  if (cmapOffset < 0) return out;
  const n = buf.readUInt16BE(cmapOffset + 2);
  const subtables: { platform: number; encoding: number; offset: number }[] = [];
  for (let i = 0; i < n; i++) {
    const rec = cmapOffset + 4 + i * 8;
    subtables.push({
      platform: buf.readUInt16BE(rec),
      encoding: buf.readUInt16BE(rec + 2),
      offset: cmapOffset + buf.readUInt32BE(rec + 4),
    });
  }
  const pick = (format: number) =>
    subtables.find(
      (s) =>
        buf.readUInt16BE(s.offset) === format &&
        ((s.platform === 3 && (s.encoding === 1 || s.encoding === 10)) || s.platform === 0),
    );
  const f12 = pick(12);
  if (f12) {
    const groups = buf.readUInt32BE(f12.offset + 12);
    for (let g = 0; g < groups; g++) {
      const rec = f12.offset + 16 + g * 12;
      const start = buf.readUInt32BE(rec);
      const end = buf.readUInt32BE(rec + 4);
      const startGlyph = buf.readUInt32BE(rec + 8);
      for (let cp = start; cp <= end; cp++) {
        if (startGlyph + (cp - start) !== 0) out.add(cp);
      }
    }
    return out;
  }
  const f4 = pick(4);
  if (!f4) return out;
  const o = f4.offset;
  const segX2 = buf.readUInt16BE(o + 6);
  const ends = o + 14;
  const starts = ends + segX2 + 2;
  const deltas = starts + segX2;
  const rangeOffsets = deltas + segX2;
  for (let s = 0; s < segX2 / 2; s++) {
    const end = buf.readUInt16BE(ends + s * 2);
    const start = buf.readUInt16BE(starts + s * 2);
    const delta = buf.readInt16BE(deltas + s * 2);
    const ro = buf.readUInt16BE(rangeOffsets + s * 2);
    for (let cp = start; cp <= end && cp !== 0xffff; cp++) {
      let glyph: number;
      if (ro === 0) {
        glyph = (cp + delta) & 0xffff;
      } else {
        const addr = rangeOffsets + s * 2 + ro + (cp - start) * 2;
        const raw = buf.readUInt16BE(addr);
        glyph = raw === 0 ? 0 : (raw + delta) & 0xffff;
      }
      if (glyph !== 0) out.add(cp);
    }
  }
  return out;
}

// ---------- 加载（常驻内存） ----------

const g = globalThis as typeof globalThis & { __chunfengShareFonts?: Map<FontKey, LoadedFont> };

function loaded(key: FontKey): LoadedFont {
  g.__chunfengShareFonts ??= new Map();
  let f = g.__chunfengShareFonts.get(key);
  if (!f) {
    const data = readFileSync(path.join(fontsDir(), FILES[key]));
    f = { data, cmap: parseCmap(data) };
    g.__chunfengShareFonts.set(key, f);
  }
  return f;
}

/** 预热：读入全部字体并解析 cmap（约 35 MB 常驻内存） */
export function warmShareFonts(): void {
  for (const key of Object.keys(FILES) as FontKey[]) loaded(key);
}

// ---------- 字符分工 ----------

/** 应由思源宋体显示的字符：汉字、假名、谚文、全角与 CJK 标点、弯引号、省略号、间隔号、破折号 */
const CJK_PREFERRED =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}　-〿＀-￯‘’“”…·—⺀-⿟㇀-㇯㈀-㏿]/u;

function cp(ch: string): number {
  return ch.codePointAt(0) ?? 0;
}

/** 至少有一个分享图字体能显示该字符（常规字重的覆盖面即全部字重的覆盖面） */
export function isRenderable(ch: string): boolean {
  if (ch === ' ') return true;
  const c = cp(ch);
  return loaded('cjk400').cmap.has(c) || loaded('latin400').cmap.has(c);
}

/** 这个字符由哪一套字体显示 */
export function familyFor(ch: string): 'cjk' | 'latin' {
  if (CJK_PREFERRED.test(ch)) return 'cjk';
  return loaded('latin400').cmap.has(cp(ch)) ? 'latin' : 'cjk';
}

// ---------- 子集化 + LRU ----------

const LRU_MAX = 24;
const lru = new Map<string, Promise<ArrayBuffer>>();

function uniqueChars(text: string): string {
  return [...new Set(text)].sort().join('');
}

function subsetCached(key: FontKey, chars: string): Promise<ArrayBuffer> {
  const cacheKey = `${key}:${chars}`;
  const hit = lru.get(cacheKey);
  if (hit) {
    lru.delete(cacheKey);
    lru.set(cacheKey, hit);
    return hit;
  }
  const p = subsetFont(loaded(key).data, chars, { targetFormat: 'sfnt', noHinting: true }).then((buf) => {
    // 拷贝出独立的 ArrayBuffer（Buffer 可能来自共享内存池）
    const ab = new ArrayBuffer(buf.byteLength);
    new Uint8Array(ab).set(buf);
    return ab;
  });
  p.catch(() => lru.delete(cacheKey));
  lru.set(cacheKey, p);
  while (lru.size > LRU_MAX) {
    const oldest = lru.keys().next().value;
    if (oldest === undefined) break;
    lru.delete(oldest);
  }
  return p;
}

/**
 * 按本次要显示的文字与字重生成 satori 字体：
 * 思源宋体只含该由它显示的字（外加省略号，供 lineClamp / textOverflow 使用），Source Serif 4 含其余字符。
 */
export async function subsetFor(text: string, weight: ShareWeight): Promise<SatoriFont[]> {
  let cjk = '…';
  let latin = ' ';
  for (const ch of new Set(text)) {
    if (ch === '\n' || !isRenderable(ch)) continue;
    if (familyFor(ch) === 'cjk') cjk += ch;
    else latin += ch;
  }
  const cjkKey: FontKey = weight === 400 ? 'cjk400' : 'cjk600';
  const latinKey: FontKey = weight === 400 ? 'latin400' : 'latin600';
  return Promise.all([
    subsetCached(cjkKey, uniqueChars(cjk)).then((data) => ({
      name: CJK_FAMILY,
      data,
      weight,
      style: 'normal' as const,
    })),
    subsetCached(latinKey, uniqueChars(latin)).then((data) => ({
      name: LATIN_FAMILY,
      data,
      weight,
      style: 'normal' as const,
    })),
  ]);
}

/** 印章字体：书名子集（构建时已子集化，整份交给 satori） */
export function titleFont(): SatoriFont {
  const { data } = loaded('title');
  const ab = new ArrayBuffer(data.byteLength);
  new Uint8Array(ab).set(data);
  return { name: TITLE_FAMILY, data: ab, weight: 400, style: 'normal' };
}

/** 仅测试使用 */
export function clearFontSubsetCache(): void {
  lru.clear();
}
