// 生成 UI 子集字体「Chunfeng UI」与书名子集字体「Chunfeng Title」（06 §3.2）
//
// 「Chunfeng UI」：从 assets/fonts/NotoSerifSC-*.otf 中抽取 src/copy/zh.ts 全部静态文案用到的汉字，
// 加上中文标点、弯引号与提问时间（农历、时辰）会用到的字，输出 public/fonts/ui-{400,600}.woff2。
// 子集中不包含拉丁字母与数字：它们交给 Source Serif 4。
//
// 体积（实测约 210 B/字，见 06 §3.2 的实施记录）：
// - 400 / 600：全部静态文案；400 在 <head> 中 preload（封面主标题也用 400），600 只在用到时由浏览器按需下载。
// - 去掉 CFF hinting（高分屏与现代光栅化器基本不用），体积约减 15%。
//
// 「Chunfeng Title」（D20）：从玄宗体中只抽取书名用字（zh.cover.title ∪ zh.share.image.seal），
// 输出 public/fonts/title.woff2（网页）与 assets/fonts/ChunfengTitle.otf（分享图，satori 不支持 WOFF2）。
// 源文件约 39 MB，不入库：按固定提交下载到 .cache/fonts/ 并校验 sha256。
// 子集改名为「Chunfeng Title」，不沿用源字体名（源字体声明了保留字体名 `Source`）；缺字时构建失败。
//
// 用法：pnpm build:fonts

import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { collectStaticStrings, zh } from '../src/copy/zh';
import { parseCmap } from '../src/server/share/fonts';

// subset-font 没有类型声明，这里只声明用到的签名
type SubsetFont = (
  font: Buffer,
  text: string,
  options: {
    targetFormat: 'woff2' | 'woff' | 'truetype' | 'sfnt';
    noHinting?: boolean;
    preserveNameIds?: number[];
  },
) => Promise<Buffer>;
const subsetFont = createRequire(import.meta.url)('subset-font') as SubsetFont;

const ROOT = path.resolve(import.meta.dirname, '..');
const SRC_DIR = path.join(ROOT, 'assets/fonts');
const OUT_DIR = path.join(ROOT, 'public/fonts');
const CACHE_DIR = path.join(ROOT, '.cache/fonts');

/** 玄宗体源文件：固定提交与 sha256（06 §3.2）；上游发布新版本时同步更新，并重新截图确认 */
const TITLE_SOURCE = {
  file: 'XuanZongTi-v0.1.otf',
  url: 'https://raw.githubusercontent.com/kaonashi-tyc/Zi-XuanZongTi/53bf56d26e319ceb36e704411a8a69f2a5d6f9fe/data/XuanZongTi-v0.1.otf',
  sha256: 'f278b2b6e1d1808b757340fe7fd96afc3c65c9c6670677242fd6745e032d7539',
} as const;

export const TITLE_FAMILY = 'Chunfeng Title';
const TITLE_POSTSCRIPT = 'ChunfengTitle-Regular';

const WEIGHTS = [
  { weight: 400, file: 'NotoSerifSC-Regular.otf', scope: 'all' },
  { weight: 600, file: 'NotoSerifSC-SemiBold.otf', scope: 'all' },
] as const;

/** 中文标点与弯引号：即使当前文案没用到，用户提问与 LLM 输出中也很常见 */
const PUNCTUATION = '‘’“”…·—「」『』，。、！？：；（）';

/** 提问时间（src/lib/shared/datetime.ts）：年月日、天干地支、农历月日与时辰 */
const CALENDAR = '年月日时甲乙丙丁戊己庚辛壬癸子丑寅卯辰巳午未申酉戌亥正冬腊闰初十廿一二三四五六七八九';

/** 只保留汉字与全角标点；拉丁字母、数字、半角符号一律排除 */
function isUiGlyph(ch: string): boolean {
  return /\p{Script=Han}/u.test(ch) || /[　-〿＀-￯‘’“”…·—]/u.test(ch);
}

function toGlyphs(strings: readonly string[]): string {
  const set = new Set<string>();
  for (const s of strings) {
    for (const ch of s) if (isUiGlyph(ch)) set.add(ch);
  }
  return [...set].sort().join('');
}

/** 400 / 600 的字符集：全部静态文案 + 标点 + 日期用字 */
export function collectUiGlyphs(): string {
  return toGlyphs([...collectStaticStrings(), PUNCTUATION, CALENDAR]);
}

/** 书名字符集：封面主标题 ∪ 分享图印章 */
export function collectTitleGlyphs(): string {
  return [...new Set(zh.cover.title + zh.share.image.seal)].sort().join('');
}

/** 源字体缺少任何一个字时抛错 */
export function assertCovers(font: Buffer, glyphs: string): void {
  const cmap = parseCmap(font);
  const missing = [...glyphs].filter((ch) => !cmap.has(ch.codePointAt(0) ?? 0));
  if (missing.length > 0) throw new Error(`书名字体缺字：${missing.join('')}`);
}

// ---------- name 表改写 ----------

/** 被替换的名称：1 family、3 unique ID、4 full name、6 PostScript、16/17 typographic family/subfamily */
const REPLACED_NAME_IDS = new Set([1, 3, 4, 6, 16, 17]);

interface NameRecord {
  platformID: number;
  encodingID: number;
  languageID: number;
  nameID: number;
  bytes: Buffer;
}

interface SfntTable {
  tag: string;
  data: Buffer;
}

function readTables(font: Buffer): SfntTable[] {
  const numTables = font.readUInt16BE(4);
  const tables: SfntTable[] = [];
  for (let i = 0; i < numTables; i++) {
    const rec = 12 + i * 16;
    const offset = font.readUInt32BE(rec + 8);
    const length = font.readUInt32BE(rec + 12);
    tables.push({ tag: font.toString('latin1', rec, rec + 4), data: font.subarray(offset, offset + length) });
  }
  return tables;
}

function checksum(data: Buffer): number {
  const padded = Buffer.alloc(Math.ceil(data.length / 4) * 4);
  data.copy(padded);
  let sum = 0;
  for (let i = 0; i < padded.length; i += 4) sum = (sum + padded.readUInt32BE(i)) >>> 0;
  return sum;
}

function writeSfnt(sfntVersion: number, tables: SfntTable[]): Buffer {
  const sorted = [...tables].sort((a, b) => (a.tag < b.tag ? -1 : 1));
  const n = sorted.length;
  const entrySelector = Math.floor(Math.log2(n));
  const searchRange = 2 ** entrySelector * 16;
  const header = Buffer.alloc(12 + n * 16);
  header.writeUInt32BE(sfntVersion, 0);
  header.writeUInt16BE(n, 4);
  header.writeUInt16BE(searchRange, 6);
  header.writeUInt16BE(entrySelector, 8);
  header.writeUInt16BE(n * 16 - searchRange, 10);
  const bodies: Buffer[] = [];
  let offset = header.length;
  let headOffset = -1;
  sorted.forEach((t, i) => {
    const data = t.tag === 'head' ? Buffer.from(t.data) : t.data;
    if (t.tag === 'head') {
      data.writeUInt32BE(0, 8); // checkSumAdjustment 先置零
      headOffset = offset;
    }
    const rec = 12 + i * 16;
    header.write(t.tag, rec, 4, 'latin1');
    header.writeUInt32BE(checksum(data), rec + 4);
    header.writeUInt32BE(offset, rec + 8);
    header.writeUInt32BE(data.length, rec + 12);
    const padded = Buffer.alloc(Math.ceil(data.length / 4) * 4);
    data.copy(padded);
    bodies.push(padded);
    offset += padded.length;
  });
  const out = Buffer.concat([header, ...bodies]);
  if (headOffset >= 0) out.writeUInt32BE((0xb1b0afba - checksum(out)) >>> 0, headOffset + 8);
  return out;
}

function parseNameTable(name: Buffer): NameRecord[] {
  const count = name.readUInt16BE(2);
  const storage = name.readUInt16BE(4);
  const records: NameRecord[] = [];
  for (let i = 0; i < count; i++) {
    const rec = 6 + i * 12;
    const length = name.readUInt16BE(rec + 8);
    const offset = storage + name.readUInt16BE(rec + 10);
    records.push({
      platformID: name.readUInt16BE(rec),
      encodingID: name.readUInt16BE(rec + 2),
      languageID: name.readUInt16BE(rec + 4),
      nameID: name.readUInt16BE(rec + 6),
      bytes: name.subarray(offset, offset + length),
    });
  }
  return records;
}

function buildNameTable(records: NameRecord[]): Buffer {
  const sorted = [...records].sort(
    (a, b) =>
      a.platformID - b.platformID ||
      a.encodingID - b.encodingID ||
      a.languageID - b.languageID ||
      a.nameID - b.nameID,
  );
  const storageOffset = 6 + sorted.length * 12;
  const header = Buffer.alloc(storageOffset);
  header.writeUInt16BE(0, 0);
  header.writeUInt16BE(sorted.length, 2);
  header.writeUInt16BE(storageOffset, 4);
  let offset = 0;
  sorted.forEach((r, i) => {
    const rec = 6 + i * 12;
    header.writeUInt16BE(r.platformID, rec);
    header.writeUInt16BE(r.encodingID, rec + 2);
    header.writeUInt16BE(r.languageID, rec + 4);
    header.writeUInt16BE(r.nameID, rec + 6);
    header.writeUInt16BE(r.bytes.length, rec + 8);
    header.writeUInt16BE(offset, rec + 10);
    offset += r.bytes.length;
  });
  return Buffer.concat([header, ...sorted.map((r) => r.bytes)]);
}

function utf16be(text: string): Buffer {
  const le = Buffer.from(text, 'utf16le');
  const be = Buffer.alloc(le.length);
  for (let i = 0; i < le.length; i += 2) be.writeUInt16BE(le.readUInt16LE(i), i);
  return be;
}

/** 读出 name 表中 Windows 平台（3/1）英文（0x409）的名称，供测试与构建日志使用 */
export function readFontNames(font: Buffer): Map<number, string> {
  const name = readTables(font).find((t) => t.tag === 'name');
  const out = new Map<number, string>();
  if (!name) return out;
  for (const r of parseNameTable(name.data)) {
    if (r.platformID !== 3 || r.encodingID !== 1 || r.languageID !== 0x409) continue;
    const le = Buffer.alloc(r.bytes.length);
    for (let i = 0; i + 1 < r.bytes.length; i += 2) le.writeUInt16LE(r.bytes.readUInt16BE(i), i);
    out.set(r.nameID, le.toString('utf16le'));
  }
  return out;
}

/**
 * 把字体改名为 family / postscript：删除全部平台与语言下的 1、3、4、6、16、17 号名称，
 * 再写入 Windows 英文记录；版权（0）、商标（7）、许可证（13、14）等原样保留。
 */
export function renameFont(font: Buffer, family: string, postscript: string): Buffer {
  const tables = readTables(font);
  const name = tables.find((t) => t.tag === 'name');
  if (!name) throw new Error('字体缺少 name 表');
  const kept = parseNameTable(name.data).filter((r) => !REPLACED_NAME_IDS.has(r.nameID));
  const win = (nameID: number, text: string): NameRecord => ({
    platformID: 3,
    encodingID: 1,
    languageID: 0x409,
    nameID,
    bytes: utf16be(text),
  });
  const records = [
    ...kept,
    win(1, family),
    win(3, `${postscript}; subset`),
    win(4, family),
    win(6, postscript),
  ];
  name.data = buildNameTable(records);
  return writeSfnt(font.readUInt32BE(0), tables);
}

// ---------- 源字体下载与缓存 ----------

function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

/** 取玄宗体源文件：缓存中没有时按固定提交下载；无论新旧都校验 sha256 */
async function loadTitleSource(): Promise<Buffer> {
  const cached = path.join(CACHE_DIR, TITLE_SOURCE.file);
  let buf: Buffer | null = null;
  try {
    buf = await readFile(cached);
  } catch {
    console.log(`下载 ${TITLE_SOURCE.file}（约 39 MB）…`);
    const res = await fetch(TITLE_SOURCE.url);
    if (!res.ok) throw new Error(`下载书名源字体失败：HTTP ${res.status}`);
    buf = Buffer.from(await res.arrayBuffer());
    const actual = sha256(buf);
    if (actual !== TITLE_SOURCE.sha256) {
      throw new Error(`书名源字体 sha256 不一致：期望 ${TITLE_SOURCE.sha256}，实际 ${actual}`);
    }
    await mkdir(CACHE_DIR, { recursive: true });
    const tmp = `${cached}.${process.pid}.tmp`;
    await writeFile(tmp, buf);
    await rename(tmp, cached);
    return buf;
  }
  const actual = sha256(buf);
  if (actual !== TITLE_SOURCE.sha256) {
    throw new Error(`缓存的书名源字体 sha256 不一致（${cached}），请删除后重试：实际 ${actual}`);
  }
  return buf;
}

async function buildTitleFont(): Promise<void> {
  const glyphs = collectTitleGlyphs();
  const source = await loadTitleSource();
  assertCovers(source, glyphs);
  // 保留版权、商标、许可证等名称（0–14），再改名
  const subset = await subsetFont(source, glyphs, {
    targetFormat: 'sfnt',
    noHinting: true,
    preserveNameIds: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14],
  });
  const otf = renameFont(subset, TITLE_FAMILY, TITLE_POSTSCRIPT);
  // 子集化已完成，这里只做 WOFF2 封装（同一字符集再过一遍，名称表原样保留）
  const woff2 = await subsetFont(otf, glyphs, {
    targetFormat: 'woff2',
    noHinting: true,
    preserveNameIds: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14],
  });
  await writeFile(path.join(SRC_DIR, 'ChunfengTitle.otf'), otf);
  await writeFile(path.join(OUT_DIR, 'title.woff2'), woff2);
  const kb = (n: number) => (n / 1024).toFixed(1);
  console.log(`title.woff2  ${[...glyphs].length} 字  ${kb(woff2.byteLength)} KB`);
  console.log(`ChunfengTitle.otf  ${[...glyphs].length} 字  ${kb(otf.byteLength)} KB`);
}

async function main(): Promise<void> {
  const sets = { all: collectUiGlyphs() };
  await mkdir(OUT_DIR, { recursive: true });
  for (const { weight, file, scope } of WEIGHTS) {
    const glyphs = sets[scope];
    const source = await readFile(path.join(SRC_DIR, file));
    const out = await subsetFont(source, glyphs, { targetFormat: 'woff2', noHinting: true });
    await writeFile(path.join(OUT_DIR, `ui-${weight}.woff2`), out);
    const kb = (out.byteLength / 1024).toFixed(1);
    console.log(`ui-${weight}.woff2  ${[...glyphs].length} 字  ${kb} KB`);
  }
  await buildTitleFont();
}

// 仅在直接运行时执行（被测试导入时不生成文件）
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}
