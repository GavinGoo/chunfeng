import { describe, expect, it } from 'vitest';
import { cachePath, etagFor, ifNoneMatchHits } from '@/server/share/cache';

const ID = 'AAAAAAAAAAAA';

describe('分享图缓存（12 §3.1、D35）', () => {
  it('一篇答案一张图：文件名只有 id，没有版本与域名', () => {
    expect(cachePath('/x', ID)).toBe(`/x/${ID}.png`);
    expect(cachePath('/x', ID)).toBe(cachePath('/x', ID));
  });

  it('ETag 由 id 与字节数组成；If-None-Match 支持列表与 *', () => {
    const etag = etagFor(ID, 1000);
    expect(etag).toBe(`"${ID}-rs"`);
    expect(ifNoneMatchHits(etag, etag)).toBe(true);
    expect(ifNoneMatchHits(`"other", ${etag}`, etag)).toBe(true);
    expect(ifNoneMatchHits('W/"other"', etag)).toBe(false);
    expect(ifNoneMatchHits('*', etag)).toBe(true);
    expect(ifNoneMatchHits(null, etag)).toBe(false);
    expect(etagFor(ID, 1001)).not.toBe(etag);
  });
});
