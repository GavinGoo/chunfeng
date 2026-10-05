// 带图评测集的公共部分（15 §16.3）：读取 questions.vision.json，图片经与服务端相同的重编码后转为 data URL。

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { processImage } from '../src/server/image/process';
import { sniffImage } from '../src/server/image/sniff';
import type { VisionFixture } from './build-vision-fixtures';

export type { VisionFixture };

export function loadVisionFixtures(): VisionFixture[] {
  return JSON.parse(readFileSync('tests/fixtures/questions.vision.json', 'utf8')) as VisionFixture[];
}

export async function fixtureDataUrl(f: { id: string; image?: string }): Promise<string> {
  if (!f.image) throw new Error(`fixture ${f.id}: no image`);
  const raw = readFileSync(join('tests/fixtures/images', f.image));
  const format = sniffImage(raw);
  if (!format) throw new Error(`fixture ${f.id}: unsupported image`);
  const img = await processImage(raw, format);
  return `data:image/jpeg;base64,${img.full.toString('base64')}`;
}
