// 本地存储封装（07 §7）：所有读写都在 try/catch 中（Safari 无痕模式等可能抛错），失败时静默降级。

export const STORAGE_KEYS = {
  mine: 'chunfeng:mine', // localStorage：本机创建的答案 id 列表
  hintSeen: 'chunfeng:hint-seen', // localStorage：是否已看过选项提示
  draft: 'chunfeng:draft', // sessionStorage：封面输入框草稿
  draftImage: 'chunfeng:draft-image', // sessionStorage：已上传的附图（15 §10.8）
  perfTier: 'chunfeng:perf-tier', // sessionStorage：本次会话已降为 lite（16 §3.12）
  perfTierOverride: 'chunfeng:perf-tier-override', // localStorage：强制档位 full | lite（测试与评审用，16 §3.12）
} as const;

export const MINE_MAX = 200;

type Kind = 'local' | 'session';

function store(kind: Kind): Storage | null {
  try {
    if (typeof window === 'undefined') return null;
    return kind === 'local' ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
}

export function safeGet(kind: Kind, key: string): string | null {
  try {
    return store(kind)?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export function safeSet(kind: Kind, key: string, value: string): boolean {
  try {
    const s = store(kind);
    if (!s) return false;
    s.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function safeRemove(kind: Kind, key: string): void {
  try {
    store(kind)?.removeItem(key);
  } catch {
    // 忽略
  }
}

// ---- 主人态：chunfeng:mine（最多 200 条，先进先出） ----

export function getMine(): string[] {
  const raw = safeGet('local', STORAGE_KEYS.mine);
  if (!raw) return [];
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function addMine(id: string): void {
  const list = getMine().filter((x) => x !== id);
  list.push(id);
  safeSet('local', STORAGE_KEYS.mine, JSON.stringify(list.slice(-MINE_MAX)));
}

export function isMine(id: string): boolean {
  return getMine().includes(id);
}

// ---- 选项提示：chunfeng:hint-seen ----

export function hasSeenHint(): boolean {
  return safeGet('local', STORAGE_KEYS.hintSeen) === '1';
}

export function markHintSeen(): void {
  safeSet('local', STORAGE_KEYS.hintSeen, '1');
}

// ---- 草稿：chunfeng:draft ----

export function getDraft(): string {
  return safeGet('session', STORAGE_KEYS.draft) ?? '';
}

export function setDraft(text: string): void {
  if (text) safeSet('session', STORAGE_KEYS.draft, text);
  else safeRemove('session', STORAGE_KEYS.draft);
}

export function clearDraft(): void {
  safeRemove('session', STORAGE_KEYS.draft);
}

// ---- 附图草稿：chunfeng:draft-image（15 §10.8） ----

export interface DraftImage {
  imageId: string;
  width: number;
  height: number;
  /** 长边 160 px 的 JPEG data URL（≤ 16 KB）；原样上传、没有本地预览时为空 */
  thumb?: string;
}

export function getDraftImage(): DraftImage | null {
  const raw = safeGet('session', STORAGE_KEYS.draftImage);
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<DraftImage>;
    if (
      typeof v.imageId !== 'string' ||
      !/^[0-9A-Za-z]{16}$/.test(v.imageId) ||
      typeof v.width !== 'number' ||
      typeof v.height !== 'number'
    )
      return null;
    const thumb =
      typeof v.thumb === 'string' && v.thumb.startsWith('data:image/jpeg;base64,') ? v.thumb : undefined;
    return { imageId: v.imageId, width: v.width, height: v.height, thumb };
  } catch {
    return null;
  }
}

export function setDraftImage(d: DraftImage): void {
  safeSet('session', STORAGE_KEYS.draftImage, JSON.stringify(d));
}

export function clearDraftImage(): void {
  safeRemove('session', STORAGE_KEYS.draftImage);
}
