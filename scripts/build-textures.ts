// 程序生成材质纹理（06 §5）
//
// - public/textures/leather-shade.webp  512×512 可平铺：细纹小羊皮的阴影层（纯黑 + 透明度 1 − 灰度），正常叠在 --cover-800 上，
//   等价于把灰度皮纹 multiply 上去，但不依赖 background-blend-mode（iOS 16.2 不生效，封面发白）
// - public/textures/paper.webp    1024×1536：温润纸页（带颜色，DOM 与 WebGL 共用同一张）
// - public/textures/grain.png     128×128 可平铺：全屏极淡颗粒
// - public/textures/nebula.webp   1024×1024：以书为中心的双臂螺旋星云
// - public/textures/stars.png     512×512 可平铺：远景星点（不含最亮的约 8%，静止）
// - public/textures/glint-a.png   512×512、glint-b.png 384×384 可平铺：会呼吸的亮星（10 §2.1）
// - assets/share/paper.jpg        1080×1620：与 paper.webp 同样的纸，供服务端分享图使用
//
// 全部由确定性的伪随机数生成（固定种子），重复运行结果一致。
// 用法：pnpm build:textures

import { mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const ROOT = path.resolve(import.meta.dirname, '..');
const TEX_DIR = path.join(ROOT, 'public/textures');
const SHARE_DIR = path.join(ROOT, 'assets/share');

// ---------- 基础工具 ----------

/** mulberry32：小而稳定的种子随机数 */
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

/** 整数格点哈希 → [0, 1) */
function hash2(x: number, y: number, seed: number): number {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 2147483647)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const smooth = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const mod = (a: number, n: number) => ((a % n) + n) % n;

/** 周期性 value noise：period 为格点数，保证在 period 个格点处无缝衔接 */
function valueNoise(x: number, y: number, period: number, seed: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = smooth(x - x0);
  const fy = smooth(y - y0);
  const xa = mod(x0, period);
  const xb = mod(x0 + 1, period);
  const ya = mod(y0, period);
  const yb = mod(y0 + 1, period);
  const a = hash2(xa, ya, seed);
  const b = hash2(xb, ya, seed);
  const c = hash2(xa, yb, seed);
  const d = hash2(xb, yb, seed);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

/** 分形叠加；u、v ∈ [0, 1) 为纹理坐标，basePeriod 为最低频的格点数 */
function fbm(u: number, v: number, basePeriod: number, octaves: number, seed: number): number {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  let period = basePeriod;
  for (let o = 0; o < octaves; o++) {
    sum += amp * valueNoise(u * period, v * period, period, seed + o * 101);
    norm += amp;
    amp *= 0.5;
    period *= 2;
  }
  return sum / norm; // ≈ [0, 1]
}

function toGray8(values: Float32Array): Buffer {
  const out = Buffer.alloc(values.length);
  for (let i = 0; i < values.length; i++) out[i] = Math.round(clamp01(values[i] ?? 0) * 255);
  return out;
}

/** 灰度 g → 纯黑、透明度 1 − g 的 RGBA。底色 c 上正常叠加得 c·g，与 multiply 一致 */
function toShadeRgba8(values: Float32Array): Buffer {
  const out = Buffer.alloc(values.length * 4);
  for (let i = 0; i < values.length; i++) out[i * 4 + 3] = 255 - Math.round(clamp01(values[i] ?? 0) * 255);
  return out;
}

// ---------- 皮革 ----------

/**
 * 细纹小羊皮：不规则的细小颗粒（颗粒大小、高低各不相同，之间没有硬缝），
 * 叠加中频起伏与几道被扭曲过的极淡褶痕；按左上方的光求法线做浮雕明暗，再叠低频斑驳。
 * 对比很低（multiply 时只轻轻压暗），整张可无缝平铺。
 */
function leather(size: number): Float32Array {
  const height = new Float32Array(size * size);

  // 细颗粒：周期性 Worley 的 F1，颗粒顶部圆润；每颗高度随机，避免均匀的卵石感
  const cells = 96;
  const cell = size / cells;
  const rand = rng(7);
  const pts: { x: number; y: number; a: number }[] = [];
  for (let i = 0; i < cells * cells; i++) pts.push({ x: rand(), y: rand(), a: 0.45 + rand() * 0.55 });
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const gx = px / cell;
      const gy = py / cell;
      const cx = Math.floor(gx);
      const cy = Math.floor(gy);
      let f1 = 1e9;
      let amp = 1;
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          const nx = cx + ox;
          const ny = cy + oy;
          const p = pts[mod(ny, cells) * cells + mod(nx, cells)]!;
          const d = Math.hypot(gx - (nx + p.x), gy - (ny + p.y));
          if (d < f1) {
            f1 = d;
            amp = p.a;
          }
        }
      }
      const u = px / size;
      const v = py / size;
      const bump = (1 - smooth(clamp01(f1 / 0.85))) * amp;
      const swell = fbm(u, v, 24, 3, 17); // 中频起伏，打散颗粒的规律
      // 褶痕：扭曲后的脊线噪声，只取最细的一条线
      const wu = u + (fbm(u, v, 3, 2, 29) - 0.5) * 0.35;
      const wv = v + (fbm(u, v, 3, 2, 31) - 0.5) * 0.35;
      const ridge = 1 - Math.abs(fbm(wu, wv, 5, 3, 23) * 2 - 1);
      const crease = ridge ** 14;
      height[py * size + px] = bump * 0.55 + swell * 0.9 - crease * 0.7;
    }
  }

  const L = { x: -0.45, y: -0.55, z: 0.7 }; // 指向光源：左上方、偏正面
  const flat = L.z / Math.hypot(L.x, L.y, L.z);
  const at = (x: number, y: number) => height[mod(y, size) * size + mod(x, size)] ?? 0;
  const out = new Float32Array(size * size);
  const k = 0.9; // 浮雕强度
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const dx = (at(px + 1, py) - at(px - 1, py)) * k;
      const dy = (at(px, py + 1) - at(px, py - 1)) * k;
      const nl = Math.hypot(dx, dy, 1);
      const lambert = (-dx * L.x - dy * L.y + L.z) / nl / Math.hypot(L.x, L.y, L.z);
      const mottle = fbm(px / size, py / size, 3, 4, 11) - 0.5;
      const value = 0.86 + (lambert - flat) * 0.7 + mottle * 0.08;
      out[py * size + px] = Math.max(0.62, Math.min(1, value));
    }
  }
  return out;
}

// ---------- 纸页 ----------

const PAPER_100 = [0xef, 0xe5, 0xd0] as const;
const FIBER_DARK = [0x8c, 0x74, 0x55] as const;
const FIBER_LIGHT = [0xfa, 0xf4, 0xe6] as const;

/** 纸页：纸色底 + 低频云状斑驳 + 纤维 + 极细颗粒 + 极淡的边缘旧色 */
function paper(w: number, h: number): Buffer {
  const lum = new Float32Array(w * h);
  // 云状斑驳（抄纸时纤维分布不均）
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const u = x / w;
      const v = y / w; // 保持各向同性
      const cloud = fbm(u, v, 6, 5, 31) - 0.5;
      const fine = valueNoise(x * 0.7, y * 0.7, 1e6, 37) - 0.5;
      const ex = Math.min(x, w - 1 - x) / w;
      const ey = Math.min(y, h - 1 - y) / h;
      const edge = 1 - smooth(clamp01(Math.min(ex, ey) / 0.1));
      lum[y * w + x] = cloud * 0.08 + fine * 0.03 - edge * 0.03;
    }
  }

  // 纤维：细而短的弯曲线，多数略深，少数略亮
  const fiber = new Float32Array(w * h); // 正值变深，负值变亮
  const rand = rng(97);
  const count = Math.round((w * h) / 1100);
  for (let i = 0; i < count; i++) {
    let x = rand() * w;
    let y = rand() * h;
    let angle = rand() * Math.PI * 2;
    const length = 6 + rand() * rand() * 44;
    const curl = (rand() - 0.5) * 0.08;
    const strength = (rand() < 0.78 ? 1 : -0.8) * (0.25 + rand() * 0.75);
    for (let s = 0; s < length; s += 0.6) {
      angle += curl;
      x += Math.cos(angle) * 0.6;
      y += Math.sin(angle) * 0.6;
      const ix = Math.round(x);
      const iy = Math.round(y);
      if (ix < 0 || iy < 0 || ix >= w || iy >= h) break;
      // 纤维两端渐隐
      const t = s / length;
      const taper = Math.sin(Math.PI * t);
      fiber[iy * w + ix] = (fiber[iy * w + ix] ?? 0) + strength * taper * 0.45;
    }
  }

  const rgb = Buffer.alloc(w * h * 3);
  for (let i = 0; i < w * h; i++) {
    const f = Math.max(-1, Math.min(1, fiber[i] ?? 0));
    const l = 1 + (lum[i] ?? 0);
    for (let c = 0; c < 3; c++) {
      let v = (PAPER_100[c] ?? 0) * l;
      if (f > 0) v += ((FIBER_DARK[c] ?? 0) - v) * f * 0.2;
      else v += ((FIBER_LIGHT[c] ?? 0) - v) * -f * 0.5;
      rgb[i * 3 + c] = Math.round(Math.max(0, Math.min(255, v)));
    }
  }
  return rgb;
}

// ---------- 颗粒 ----------

function grain(size: number): Float32Array {
  const rand = rng(211);
  const out = new Float32Array(size * size);
  for (let i = 0; i < out.length; i++) {
    // 两个均匀分布相加，近似三角分布，颗粒更柔和
    out[i] = (rand() + rand()) / 2;
  }
  return out;
}

// ---------- 星云 ----------

type Rgb = readonly [number, number, number];

// 各成分的发光颜色（0–1，线性叠加后统一做色调映射）
const NEB_ABYSS: Rgb = [0.05, 0.07, 0.26]; // 深蓝：外围弥散光
const NEB_VIOLET: Rgb = [0.3, 0.1, 0.52]; // 暗紫：旋臂主体
const NEB_MAGENTA: Rgb = [0.52, 0.12, 0.46]; // 品红：旋臂迎光的一侧
const NEB_LILAC: Rgb = [0.8, 0.7, 1]; // 淡紫白：旋臂最浓处

const ch = (col: Rgb, c: number) => col[c] ?? 0;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smoothstep = (e0: number, e1: number, x: number) => {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};

/**
 * 星旋：以书为中心的双臂对数螺旋星云（10 §2「北辰居中，众星共之」）。
 * 中心是一片暗空（书在其上），旋臂从书的四周向外盘旋，外围渐隐为深蓝弥散光；
 * 在对数极坐标下采样噪声，气体沿旋臂拉成丝缕；旋臂内侧挖出暗尘带，最浓处透出淡紫白。
 * 各成分按颜色线性叠加发光，再逐通道做 1 − e^(−x) 色调映射。黑底输出，前端以 screen 叠加并缓慢旋转。
 */
function nebula(size: number): Buffer {
  const exposure = 1.35;
  const twist = 2.8; // 螺旋缠绕程度：φ = θ − twist · ln r
  const TAU = Math.PI * 2;
  const rgb = Buffer.alloc(size * size * 3);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      // 域扭曲：让旋臂边缘破碎、流动
      const wu = u + (fbm(u, v, 3, 5, 601) - 0.5) * 0.1;
      const wv = v + (fbm(u, v, 3, 5, 607) - 0.5) * 0.1;
      const dx = (wu - 0.5) * 2;
      const dy = (wv - 0.5) * 2;
      const r = Math.max(0.02, Math.hypot(dx, dy)); // 0 = 中心，1 = 边缘中点
      const lr = Math.log(r);
      const phi = Math.atan2(dy, dx) - twist * lr;

      // 对数极坐标下采样噪声：沿旋臂方向拉长成丝缕（φ 方向周期闭合，无接缝）
      const pu = mod(phi / TAU, 1);
      const pv = (lr + 4) * 0.12;
      const streak = fbm(pu, pv, 14, 5, 641);
      const streak2 = fbm(pu, pv * 1.6, 22, 4, 653);
      const gas = fbm(wu, wv, 4, 6, 619);

      // 双臂：cos(2φ) 的波峰为旋臂，气体噪声扰动其相位
      const arm = (0.5 + 0.5 * Math.cos(2 * phi + (gas - 0.5) * 1.8)) ** 3;
      const lane = (0.5 + 0.5 * Math.cos(2 * phi + 0.75)) ** 10 * smoothstep(0.4, 0.65, streak2); // 旋臂内侧暗尘
      // 径向包络：中心暗空（书的位置）→ 中段最浓 → 外围渐隐
      const envelope = smoothstep(0.2, 0.5, r) * Math.exp(-(((r - 0.68) / 0.46) ** 2));
      const outer = smoothstep(0.25, 0.8, r) * Math.exp(-(((r - 1) / 0.55) ** 2));

      const shade = 1 - 0.85 * lane;
      const wisps = smoothstep(0.35, 0.72, streak) * (0.55 + 0.45 * smoothstep(0.3, 0.7, gas));
      const body = envelope * arm * wisps * shade * 1.1;
      const glow = (outer * 0.5 + envelope * 0.18) * smoothstep(0.25, 0.8, gas) * shade;
      const hot =
        envelope * arm ** 2 * smoothstep(0.55, 0.85, streak) ** 2 * smoothstep(0.45, 0.75, streak2) * shade;
      // 品红只出现在旋臂迎光（外缘）一侧
      const blush = smoothstep(0.5, 0.85, 0.5 + 0.5 * Math.cos(2 * phi - 0.6)) * smoothstep(0.45, 0.7, gas);

      for (let c = 0; c < 3; c++) {
        const armCol = lerp(ch(NEB_VIOLET, c), ch(NEB_MAGENTA, c), blush);
        const emit = glow * ch(NEB_ABYSS, c) + body * armCol + hot * ch(NEB_LILAC, c) * 0.7;
        rgb[(y * size + x) * 3 + c] = Math.round((1 - Math.exp(-emit * exposure)) * 255);
      }
    }
  }
  return rgb;
}

// ---------- 星空 ----------

const STAR_TINTS: readonly Rgb[] = [
  [255, 248, 232], // 米白
  [226, 232, 255], // 冷白
  [255, 232, 196], // 暖白：与烫金呼应
];

/** 远景星点与闪烁亮星的分界：幂律亮度 mag = u⁵，u > 0.92 即最亮的约 8%（10 §2.1） */
const GLINT_MAG = 0.92 ** 5;

/** 星点画布：在可平铺的黑底上叠加高斯星点 */
function starCanvas(size: number) {
  const acc = new Float32Array(size * size * 3);
  const splat = (cx: number, cy: number, sigma: number, peak: number, tint: Rgb) => {
    const r = Math.ceil(sigma * 3);
    for (let oy = -r; oy <= r; oy++) {
      for (let ox = -r; ox <= r; ox++) {
        const px = Math.floor(cx) + ox;
        const py = Math.floor(cy) + oy;
        const dd = (px + 0.5 - cx) ** 2 + (py + 0.5 - cy) ** 2;
        const a = peak * Math.exp(-dd / (2 * sigma * sigma));
        if (a < 0.002) continue;
        const i = (mod(py, size) * size + mod(px, size)) * 3;
        for (let c = 0; c < 3; c++) acc[i + c] = (acc[i + c] ?? 0) + a * ch(tint, c);
      }
    }
  };
  const toRgb = (): Buffer => {
    const rgb = Buffer.alloc(size * size * 3);
    for (let i = 0; i < rgb.length; i++) rgb[i] = Math.round(Math.min(255, acc[i] ?? 0));
    return rgb;
  };
  return { splat, toRgb };
}

const pickTint = (t: number): Rgb =>
  (t < 0.55 ? STAR_TINTS[0] : t < 0.85 ? STAR_TINTS[1] : STAR_TINTS[2]) as Rgb;

/**
 * 星空远景：可平铺的星点，绝大多数极暗极小；米白为主，少数冷白、暖白。黑底输出，前端以 screen 叠加。
 * 最亮的约 8% 不画（照常消耗随机数，其余星点的位置与拆分前一致），改由会呼吸的 glint 层承担。
 */
function stars(size: number, count: number): Buffer {
  const { splat, toRgb } = starCanvas(size);
  const rand = rng(503);
  for (let i = 0; i < count; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const mag = rand() ** 5; // 幂律：亮星稀少
    const t = rand();
    if (mag > GLINT_MAG) continue;
    const tint = pickTint(t);
    // 星核收窄、峰值提高：亮点更锐利
    splat(x, y, 0.36 + mag * 0.4, 0.3 + mag * 0.9, tint);
    if (mag > 0.55) splat(x, y, 1.8 + mag * 1.4, 0.06 * mag, tint);
  }
  return toRgb();
}

/** 闪烁亮星：只含亮度落在最亮 8% 区间的星点，星核外加一圈极淡的光晕；前端整层做透明度呼吸 */
function glints(size: number, count: number, seed: number): Buffer {
  const { splat, toRgb } = starCanvas(size);
  const rand = rng(seed);
  for (let i = 0; i < count; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const mag = (0.92 + rand() * 0.08) ** 5;
    const tint = pickTint(rand());
    splat(x, y, 0.36 + mag * 0.4, 0.3 + mag * 0.9, tint);
    splat(x, y, 1.8 + mag * 1.4, 0.06 * mag, tint);
    splat(x, y, 4.5 + mag * 2, 0.018 * mag, tint);
  }
  return toRgb();
}

// ---------- 输出 ----------

async function sizeOf(file: string): Promise<number> {
  return (await stat(file)).size;
}

async function main(): Promise<void> {
  await mkdir(TEX_DIR, { recursive: true });
  await mkdir(SHARE_DIR, { recursive: true });

  const leatherFile = path.join(TEX_DIR, 'leather-shade.webp');
  await sharp(toShadeRgba8(leather(512)), { raw: { width: 512, height: 512, channels: 4 } })
    .webp({ quality: 62, alphaQuality: 20, effort: 6 })
    .toFile(leatherFile);

  const paperW = 1024;
  const paperH = 1536;
  const paperRaw = paper(paperW, paperH);
  const paperFile = path.join(TEX_DIR, 'paper.webp');
  await sharp(paperRaw, { raw: { width: paperW, height: paperH, channels: 3 } })
    .webp({ quality: 80, effort: 6, smartSubsample: true })
    .toFile(paperFile);

  // 分享图纸面：同一张纸放大到 1080×1620（比例相同）
  const shareFile = path.join(SHARE_DIR, 'paper.jpg');
  await sharp(paperRaw, { raw: { width: paperW, height: paperH, channels: 3 } })
    .resize(1080, 1620, { kernel: 'lanczos3' })
    .jpeg({ quality: 82, mozjpeg: true })
    .toFile(shareFile);

  const grainFile = path.join(TEX_DIR, 'grain.png');
  await sharp(toGray8(grain(128)), { raw: { width: 128, height: 128, channels: 1 } })
    .png({ palette: true, colors: 16, compressionLevel: 9 })
    .toFile(grainFile);

  const nebulaSize = 1024;
  const nebulaFile = path.join(TEX_DIR, 'nebula.webp');
  await sharp(nebula(nebulaSize), { raw: { width: nebulaSize, height: nebulaSize, channels: 3 } })
    .webp({ quality: 86, effort: 6 })
    .toFile(nebulaFile);

  const starsSize = 512;
  const starsFile = path.join(TEX_DIR, 'stars.png');
  await sharp(stars(starsSize, 340), { raw: { width: starsSize, height: starsSize, channels: 3 } })
    .png({ palette: true, colors: 64, compressionLevel: 9 })
    .toFile(starsFile);

  // 两张边长不同、种子不同，平铺的重复图样互相错开
  const glintFiles: string[] = [];
  for (const [name, size, count, seed] of [
    ['glint-a.png', 512, 12, 509],
    ['glint-b.png', 384, 10, 521],
  ] as const) {
    const file = path.join(TEX_DIR, name);
    await sharp(glints(size, count, seed), { raw: { width: size, height: size, channels: 3 } })
      .png({ palette: true, colors: 64, compressionLevel: 9 })
      .toFile(file);
    glintFiles.push(file);
  }

  let total = 0;
  for (const f of [leatherFile, paperFile, grainFile, nebulaFile, starsFile, ...glintFiles]) {
    const n = await sizeOf(f);
    total += n;
    console.log(`${path.relative(ROOT, f)}  ${(n / 1024).toFixed(1)} KB`);
  }
  console.log(`public/textures 合计  ${(total / 1024).toFixed(1)} KB（预算 150 KB）`);
  console.log(`${path.relative(ROOT, shareFile)}  ${((await sizeOf(shareFile)) / 1024).toFixed(1)} KB`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
