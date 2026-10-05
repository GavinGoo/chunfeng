import { describe, expect, it } from 'vitest';
import {
  aigcMark,
  crc32,
  insertBeforeIend,
  itxtChunk,
  readChunks,
  readTextChunks,
  textChunk,
  withShareMetadata,
} from '@/server/share/metadata';

// 最小合法 PNG：1×1 RGB 像素（由 sharp 生成）
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADElEQVQImWNoaGgAAAMEAYEezv+mAAAAAElFTkSuQmCC',
  'base64',
);

function verifyCrcs(png: Buffer): void {
  for (const c of readChunks(png)) {
    const typeAndData = png.subarray(c.offset + 4, c.offset + 8 + c.data.length);
    expect(crc32(typeAndData)).toBe(c.crc);
  }
}

describe('PNG 文本块（12 §5）', () => {
  it('crc32 与已知值一致', () => {
    expect(crc32(Buffer.from('IEND', 'latin1'))).toBe(0xae426082);
    expect(crc32(Buffer.from('123456789'))).toBe(0xcbf43926);
  });

  it('原始 PNG 的 CRC 可被正确校验', () => {
    verifyCrcs(TINY_PNG);
  });

  it('tEXt 写入后可解析，CRC 正确，位于 IEND 之前', () => {
    const out = insertBeforeIend(TINY_PNG, [textChunk('Software', 'chunfeng test')]);
    verifyCrcs(out);
    const chunks = readChunks(out);
    expect(chunks.map((c) => c.type)).toEqual(['IHDR', 'pHYs', 'IDAT', 'tEXt', 'IEND']);
    expect(readTextChunks(out)).toEqual({ Software: 'chunfeng test' });
    // 原图数据未被改动
    expect(out.subarray(0, chunks[3]!.offset).equals(TINY_PNG.subarray(0, chunks[3]!.offset))).toBe(true);
  });

  it('tEXt 拒绝非 Latin-1 文本与非法关键字', () => {
    expect(() => textChunk('AIGC', '春风')).toThrow();
    expect(() => textChunk(' bad', 'x')).toThrow();
    expect(() => textChunk('', 'x')).toThrow();
  });

  it('iTXt 支持 UTF-8', () => {
    const out = insertBeforeIend(TINY_PNG, [itxtChunk('Description', '内容由 AI 生成', 'zh-CN')]);
    verifyCrcs(out);
    expect(readTextChunks(out).Description).toBe('内容由 AI 生成');
  });

  it('withShareMetadata 写入 AIGC JSON、Software 与 Description', () => {
    const out = withShareMetadata(TINY_PNG, { readingId: 'AbCdEfGhIjKl' });
    verifyCrcs(out);
    const t = readTextChunks(out);
    expect(JSON.parse(t.AIGC ?? '')).toEqual(aigcMark('AbCdEfGhIjKl'));
    expect(JSON.parse(t.AIGC ?? '')).toMatchObject({
      Label: '1',
      ContentProducer: '春风',
      ProduceID: 'AbCdEfGhIjKl',
    });
    expect(t.Software).toBe('chunfeng share-image');
    expect(t.Description).toBe('内容由 AI 生成，仅供参考');
    expect(readChunks(out).at(-1)?.type).toBe('IEND');
  });

  it('非 PNG 输入报错', () => {
    expect(() => readChunks(Buffer.from('not a png at all'))).toThrow();
  });
});
