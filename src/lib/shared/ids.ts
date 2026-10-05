// 公开 ID 与页码
export const READING_ID_RE = /^[A-Za-z0-9_-]{12}$/;

export function isReadingId(id: unknown): id is string {
  return typeof id === 'string' && READING_ID_RE.test(id);
}

/** 装饰性页码：由 id 哈希得出，100–999（FNV-1a） */
export function pageNoFromId(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return 100 + (h % 900);
}
