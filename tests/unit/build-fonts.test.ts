import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { zh } from '@/copy/zh';
import { parseCmap } from '@/server/share/fonts';
import {
  assertCovers,
  collectTitleGlyphs,
  readFontNames,
  renameFont,
  TITLE_FAMILY,
} from '../../scripts/build-fonts';

const titleOtf = readFileSync(path.join(process.cwd(), 'assets/fonts/ChunfengTitle.otf'));

describe('书名子集字体「Chunfeng Title」（06 §3.2）', () => {
  it('字符集是封面主标题与分享图印章的并集', () => {
    const glyphs = collectTitleGlyphs();
    for (const ch of zh.cover.title + zh.share.image.seal) expect(glyphs).toContain(ch);
    expect(new Set(glyphs).size).toBe([...glyphs].length);
    expect([...glyphs].every((ch) => (zh.cover.title + zh.share.image.seal).includes(ch))).toBe(true);
  });

  it('入库的子集覆盖全部书名用字（改了文案却没重跑 pnpm build:fonts 时失败）', () => {
    const cmap = parseCmap(titleOtf);
    for (const ch of collectTitleGlyphs()) expect(cmap.has(ch.codePointAt(0) ?? 0)).toBe(true);
    expect(() => assertCovers(titleOtf, collectTitleGlyphs())).not.toThrow();
  });

  it('缺字时报错并列出缺的字', () => {
    expect(() => assertCovers(titleOtf, '春风吹')).toThrow(/缺字：吹/);
  });

  it('子集已改名，不沿用源字体名；版权与许可证名称保留', () => {
    const names = readFontNames(titleOtf);
    expect(names.get(1)).toBe(TITLE_FAMILY);
    expect(names.get(4)).toBe(TITLE_FAMILY);
    expect(names.get(6)).toBe('ChunfengTitle-Regular');
    for (const id of [1, 3, 4, 6]) expect(names.get(id)).not.toMatch(/Source|XuanZong/);
    expect(names.get(0)).toBeTruthy();
    expect(names.get(13)).toMatch(/Open Font License/);
  });

  it('renameFont 可重复执行，结果仍是合法 sfnt', () => {
    const renamed = renameFont(titleOtf, 'Test Family', 'TestFamily-Regular');
    expect(readFontNames(renamed).get(1)).toBe('Test Family');
    expect(parseCmap(renamed)).toEqual(parseCmap(titleOtf));
    // head.checkSumAdjustment 使整个文件的校验和为 0xB1B0AFBA
    const padded = Buffer.alloc(Math.ceil(renamed.length / 4) * 4);
    renamed.copy(padded);
    let sum = 0;
    for (let i = 0; i < padded.length; i += 4) sum = (sum + padded.readUInt32BE(i)) >>> 0;
    expect(sum).toBe(0xb1b0afba);
  });
});
