// 答案页照片的倾斜（15 §11.2）：纯函数，由 reading id 的哈希确定，
// 保证同一条答案每次打开都相同，SSR 与水合一致；分享图取横屏的角度（15 §12）。
export type PhotoMode = 'single' | 'spread';

/** FNV-1a */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/** mulberry32：确定性伪随机，返回 [0, 1) */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const round2 = (x: number) => Math.round(x * 100) / 100;

/** 整张照片的倾斜角（deg）：竖屏 ±[1, 3]，横屏 ±[1, 2] */
export function photoTilt(id: string, mode: PhotoMode): number {
  const next = rng(hash(`${id}:${mode}`));
  const sign = next() < 0.5 ? -1 : 1;
  const max = mode === 'single' ? 3 : 2;
  return round2(sign * (1 + next() * (max - 1)));
}

/** 竖屏相片（含白边）的外框尺寸：高 72 px（紧凑 56 px），宽度按图片比例限制在 56–96 px */
export function singlePhotoBox(
  image: { width: number; height: number },
  compact: boolean,
): { width: number; height: number } {
  const height = compact ? 56 : 72;
  const chrome = 4 * 2 + 2; // 白边 4 px ×2 + 细框 1 px ×2
  const ratio = image.width > 0 && image.height > 0 ? image.width / image.height : 1;
  const width = Math.round(Math.min(96, Math.max(56, (height - chrome) * ratio + chrome)));
  return { width, height };
}
