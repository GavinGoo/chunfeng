import { zh } from '@/copy/zh';

// PNG 隐式标识（12 §5）：在 IEND 之前插入 tEXt / iTXt 文本块。
//
// 当前写入：
// - iTXt `AIGC`：JSON，字段参照 GB 45438-2025 附录中的元数据隐式标识结构
//   （Label / ContentProducer / ProduceID / ReservedCode1 / ContentPropagator / PropagateID / ReservedCode2）。
//   **字段名与取值上线前需按标准原文核实**（见 12 §5 的实施记录）。
// - tEXt `Software`：生成程序。
// - iTXt `Description`：显式标识文案的机读副本。

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// ---------- CRC-32（ISO 3309，PNG 规范附录） ----------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// ---------- 块的编码 ----------

function chunk(type: string, data: Buffer): Buffer {
  const typeBuf = Buffer.from(type, 'latin1');
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  typeBuf.copy(out, 4);
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 8 + data.length);
  return out;
}

function assertKeyword(keyword: string): void {
  // PNG 规范：1–79 个 Latin-1 可打印字符，不含首尾空格
  if (!/^[\x20-\x7e\xa1-\xff]{1,79}$/.test(keyword) || keyword.trim() !== keyword) {
    throw new Error(`invalid PNG text keyword: ${keyword}`);
  }
}

/** tEXt：关键字与文本均为 Latin-1 */
export function textChunk(keyword: string, text: string): Buffer {
  assertKeyword(keyword);
  if ([...text].some((ch) => (ch.codePointAt(0) ?? 0) > 0xff))
    throw new Error('tEXt only supports Latin-1; use iTXt');
  return chunk(
    'tEXt',
    Buffer.concat([Buffer.from(keyword, 'latin1'), Buffer.from([0]), Buffer.from(text, 'latin1')]),
  );
}

/** iTXt：UTF-8 文本，不压缩，语言标签与翻译关键字可选 */
export function itxtChunk(keyword: string, text: string, languageTag = ''): Buffer {
  assertKeyword(keyword);
  return chunk(
    'iTXt',
    Buffer.concat([
      Buffer.from(keyword, 'latin1'),
      Buffer.from([0, 0, 0]), // 关键字结束、未压缩、压缩方法 0
      Buffer.from(languageTag, 'latin1'),
      Buffer.from([0]),
      Buffer.from([0]), // 翻译关键字为空
      Buffer.from(text, 'utf8'),
    ]),
  );
}

// ---------- 读取与插入 ----------

export interface PngChunk {
  type: string;
  data: Buffer;
  /** 在文件中的起始偏移（长度字段处） */
  offset: number;
  crc: number;
}

export function readChunks(png: Buffer): PngChunk[] {
  if (png.length < 8 || !png.subarray(0, 8).equals(PNG_SIGNATURE)) throw new Error('not a PNG');
  const out: PngChunk[] = [];
  let p = 8;
  while (p + 12 <= png.length) {
    const len = png.readUInt32BE(p);
    const type = png.toString('latin1', p + 4, p + 8);
    if (p + 12 + len > png.length) throw new Error('truncated PNG chunk');
    out.push({ type, data: png.subarray(p + 8, p + 8 + len), offset: p, crc: png.readUInt32BE(p + 8 + len) });
    p += 12 + len;
    if (type === 'IEND') break;
  }
  return out;
}

/** 在 IEND 之前插入若干块 */
export function insertBeforeIend(png: Buffer, chunks: readonly Buffer[]): Buffer {
  const iend = readChunks(png).find((c) => c.type === 'IEND');
  if (!iend) throw new Error('PNG without IEND');
  return Buffer.concat([png.subarray(0, iend.offset), ...chunks, png.subarray(iend.offset)]);
}

/** 解析 tEXt / iTXt（未压缩）为 { keyword: text } */
export function readTextChunks(png: Buffer): Record<string, string> {
  const out: Record<string, string> = {};
  for (const c of readChunks(png)) {
    if (c.type === 'tEXt') {
      const nul = c.data.indexOf(0);
      out[c.data.toString('latin1', 0, nul)] = c.data.toString('latin1', nul + 1);
    } else if (c.type === 'iTXt') {
      const nul = c.data.indexOf(0);
      const keyword = c.data.toString('latin1', 0, nul);
      if (c.data[nul + 1] !== 0) continue; // 压缩的 iTXt 不在此解析
      const langEnd = c.data.indexOf(0, nul + 3);
      const transEnd = c.data.indexOf(0, langEnd + 1);
      out[keyword] = c.data.toString('utf8', transEnd + 1);
    }
  }
  return out;
}

// ---------- 春风的 AI 生成内容标识 ----------

export const SERVICE_NAME = '春风';

export interface AigcMark {
  Label: '1';
  ContentProducer: string;
  ProduceID: string;
  ReservedCode1: string;
  ContentPropagator: string;
  PropagateID: string;
  ReservedCode2: string;
}

export function aigcMark(readingId: string): AigcMark {
  return {
    Label: '1', // 1 = AI 生成
    ContentProducer: SERVICE_NAME,
    ProduceID: readingId,
    ReservedCode1: '',
    ContentPropagator: SERVICE_NAME,
    PropagateID: readingId,
    ReservedCode2: '',
  };
}

export function withShareMetadata(png: Buffer, opts: { readingId: string }): Buffer {
  return insertBeforeIend(png, [
    itxtChunk('AIGC', JSON.stringify(aigcMark(opts.readingId))),
    textChunk('Software', 'chunfeng share-image'),
    itxtChunk('Description', zh.answer.aiLabel, 'zh-CN'),
  ]);
}
