/**
 * 纸页纹理（09 §6）：`blank` 与伪文字 `written-1…3`，用 Canvas 2D 生成，CSS 与 WebGL 引擎共用。
 *
 * - 底纹来自 `/textures/paper.webp`（与 DOM 纸页同一张图，按 100% × 100% 拉伸到页面）；
 *   加载失败时退回程序生成的纸色，保证任何情况下都不阻塞。
 * - 伪文字不依赖任何字体，只用随机短笔画组成，不可辨认。
 * - 同一尺寸只生成一次（模块级缓存）。
 */

export const PAPER_URL = '/textures/paper.webp';
/** 与 06 §2 的 --paper-100 / --ink-900 一致 */
export const PAPER_COLOR = '#efe5d0';
const INK_RGB = '42,34,27';
const MAX_TEXTURE_W = 1024;

export interface PageTextureSet {
  width: number;
  height: number;
  blank: HTMLCanvasElement;
  written: readonly [HTMLCanvasElement, HTMLCanvasElement, HTMLCanvasElement];
}

type PaperSource = HTMLImageElement | ImageBitmap | null;

let paperPromise: Promise<PaperSource> | null = null;
const setCache = new Map<string, Promise<PageTextureSet>>();

export function textureSize(
  pageW: number,
  pageH: number,
  dpr: number,
  maxTextureSize = 4096,
): { w: number; h: number } {
  const scale = Math.min(Math.max(dpr, 1), 2);
  let w = Math.min(Math.round(pageW * scale), MAX_TEXTURE_W, maxTextureSize);
  let h = Math.round((w * pageH) / pageW);
  if (h > maxTextureSize) {
    h = maxTextureSize;
    w = Math.round((h * pageW) / pageH);
  }
  return { w: Math.max(2, w), h: Math.max(2, h) };
}

/** 加载纸张底纹；失败（文件尚不存在、解码失败）时返回 null，由调用方绘制程序纸色 */
export function loadPaper(): Promise<PaperSource> {
  if (paperPromise) return paperPromise;
  paperPromise = new Promise<PaperSource>((resolve) => {
    if (typeof Image === 'undefined') {
      resolve(null);
      return;
    }
    const img = new Image();
    img.decoding = 'async';
    const timer = setTimeout(() => resolve(null), 4000);
    img.onload = () => {
      clearTimeout(timer);
      resolve(img.naturalWidth > 0 ? img : null);
    };
    img.onerror = () => {
      clearTimeout(timer);
      resolve(null);
    };
    img.src = PAPER_URL;
  });
  return paperPromise;
}

function idle(): Promise<void> {
  return new Promise((resolve) => {
    const w = globalThis as typeof globalThis & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
    };
    if (typeof w.requestIdleCallback === 'function') w.requestIdleCallback(() => resolve(), { timeout: 120 });
    else setTimeout(resolve, 0);
  });
}

function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function ctx2d(c: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('canvas 2d unavailable');
  return ctx;
}

/** 可复现的伪随机（mulberry32），同一种子生成同一张纹理 */
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

function drawPaper(ctx: CanvasRenderingContext2D, w: number, h: number, paper: PaperSource): void {
  if (paper) {
    ctx.drawImage(paper, 0, 0, w, h);
    return;
  }
  ctx.fillStyle = PAPER_COLOR;
  ctx.fillRect(0, 0, w, h);
  // 极淡的纤维，只是为了不显得「塑料」；与纯色 DOM 纸页并排时不可察觉
  const r = rng(7);
  ctx.lineWidth = Math.max(1, w / 900);
  for (let i = 0; i < 260; i++) {
    const x = r() * w;
    const y = r() * h;
    const len = (0.01 + r() * 0.03) * w;
    const ang = r() * Math.PI;
    ctx.strokeStyle = r() < 0.5 ? 'rgba(120,96,60,0.035)' : 'rgba(255,250,240,0.05)';
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(
      x + Math.cos(ang) * len * 0.5 + (r() - 0.5) * len * 0.3,
      y + Math.sin(ang) * len * 0.5 + (r() - 0.5) * len * 0.3,
      x + Math.cos(ang) * len,
      y + Math.sin(ang) * len,
    );
    ctx.stroke();
  }
}

/** 伪文字：按真实版心留白，逐行绘制随机短笔画组成的「字」 */
function drawWriting(ctx: CanvasRenderingContext2D, w: number, h: number, seed: number, astrolabe: boolean) {
  const r = rng(seed);
  const left = w * 0.1;
  const right = w * 0.9;
  const top = h * 0.12;
  const bottom = h * 0.9;
  const lineH = h * 0.032;
  const glyph = lineH * 0.56;
  const advance = glyph * 1.14;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(1, w * 0.0021);

  let astroBox: { cx: number; cy: number; rad: number } | null = null;
  if (astrolabe) {
    const rad = (right - left) * 0.3;
    astroBox = { cx: (left + right) / 2, cy: top + (bottom - top) * (0.35 + r() * 0.3), rad };
  }

  let y = top + lineH;
  let paragraphLeft = 2 + Math.floor(r() * 5);
  let indent = true;
  while (y < bottom) {
    // 与星盘图重叠的行留空
    if (astroBox && Math.abs(y - astroBox.cy) < astroBox.rad + lineH) {
      y += lineH;
      continue;
    }
    const hasText = r() < 0.9;
    if (hasText) {
      const isLast = paragraphLeft <= 1;
      const x0 = left + (indent ? advance * 2 : 0);
      const x1 = isLast ? x0 + (right - x0) * (0.25 + r() * 0.6) : right;
      const alpha = 0.06 + r() * 0.04;
      ctx.strokeStyle = `rgba(${INK_RGB},${alpha.toFixed(3)})`;
      ctx.beginPath();
      for (let x = x0; x + glyph <= x1; x += advance) {
        // 偶尔一个标点大小的空隙
        if (r() < 0.06) continue;
        const strokes = 2 + Math.floor(r() * 3);
        for (let k = 0; k < strokes; k++) {
          const sx = x + r() * glyph;
          const sy = y - glyph + r() * glyph;
          const horizontal = r() < 0.55;
          const len = glyph * (0.35 + r() * 0.65);
          const ex = horizontal ? Math.min(x + glyph, sx + len) : sx + (r() - 0.5) * glyph * 0.4;
          const ey = horizontal ? sy + (r() - 0.5) * glyph * 0.2 : Math.min(y, sy + len);
          ctx.moveTo(sx, sy);
          ctx.quadraticCurveTo(
            (sx + ex) / 2 + (r() - 0.5) * glyph * 0.25,
            (sy + ey) / 2 + (r() - 0.5) * glyph * 0.25,
            ex,
            ey,
          );
        }
      }
      ctx.stroke();
      indent = false;
      paragraphLeft--;
      if (paragraphLeft <= 0) {
        // 段落之间空一行
        y += lineH;
        paragraphLeft = 2 + Math.floor(r() * 6);
        indent = true;
      }
    }
    y += lineH;
  }

  if (astroBox) {
    const { cx, cy, rad } = astroBox;
    ctx.strokeStyle = `rgba(${INK_RGB},0.07)`;
    ctx.lineWidth = Math.max(1, w * 0.0016);
    ctx.beginPath();
    for (const f of [1, 0.82, 0.5, 0.18]) {
      ctx.moveTo(cx + rad * f, cy);
      ctx.arc(cx, cy, rad * f, 0, Math.PI * 2);
    }
    const spokes = 12;
    for (let i = 0; i < spokes; i++) {
      const a = (i / spokes) * Math.PI * 2;
      ctx.moveTo(cx + Math.cos(a) * rad * 0.18, cy + Math.sin(a) * rad * 0.18);
      ctx.lineTo(cx + Math.cos(a) * rad, cy + Math.sin(a) * rad);
    }
    // 外圈刻度
    for (let i = 0; i < 72; i++) {
      const a = (i / 72) * Math.PI * 2;
      const inner = i % 6 === 0 ? 0.9 : 0.95;
      ctx.moveTo(cx + Math.cos(a) * rad * inner, cy + Math.sin(a) * rad * inner);
      ctx.lineTo(cx + Math.cos(a) * rad, cy + Math.sin(a) * rad);
    }
    ctx.stroke();
    // 一道偏心的椭圆轨道
    ctx.beginPath();
    ctx.ellipse(cx + rad * 0.12, cy - rad * 0.08, rad * 0.62, rad * 0.4, -0.5, 0, Math.PI * 2);
    ctx.stroke();
  }
}

async function buildSet(w: number, h: number): Promise<PageTextureSet> {
  const paper = await loadPaper();
  await idle();
  const blank = makeCanvas(w, h);
  drawPaper(ctx2d(blank), w, h, paper);
  const written: HTMLCanvasElement[] = [];
  for (let i = 0; i < 3; i++) {
    await idle();
    const c = makeCanvas(w, h);
    const ctx = ctx2d(c);
    ctx.drawImage(blank, 0, 0);
    drawWriting(ctx, w, h, 1013 + i * 7919, i === 1);
    written.push(c);
  }
  const [a, b, c] = written as [HTMLCanvasElement, HTMLCanvasElement, HTMLCanvasElement];
  return { width: w, height: h, blank, written: [a, b, c] };
}

/** 生成（或取缓存的）一套纸页纹理。首页空闲时即可调用预热。 */
export function getPageTextures(
  pageW: number,
  pageH: number,
  dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1,
  maxTextureSize = 4096,
): Promise<PageTextureSet> {
  const { w, h } = textureSize(pageW, pageH, dpr, maxTextureSize);
  const key = `${w}x${h}`;
  let p = setCache.get(key);
  if (!p) {
    p = buildSet(w, h);
    setCache.set(key, p);
    p.catch(() => setCache.delete(key));
  }
  return p;
}

/** 把纹理转成 object URL，供 CSS 引擎作背景图（同一张画布只转换一次） */
const urlCache = new WeakMap<HTMLCanvasElement, Promise<string>>();
export function canvasUrl(c: HTMLCanvasElement): Promise<string> {
  let p = urlCache.get(c);
  if (!p) {
    p = new Promise<string>((resolve) => {
      c.toBlob(
        (blob) => resolve(blob ? URL.createObjectURL(blob) : c.toDataURL('image/png')),
        'image/webp',
        0.92,
      );
    });
    urlCache.set(c, p);
  }
  return p;
}
