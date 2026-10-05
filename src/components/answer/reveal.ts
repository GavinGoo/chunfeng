// 墨迹显现编排的时间计算（11 §5）：纯函数，便于单元测试。
// useReveal 按这里给出的时间表，用 WAAPI 在 DOM 上执行。

import type { BookMode } from '@/components/book/geometry';

/** 11 §5 时间表（ms） */
export const INK = {
  headDur: 300,
  questionStart: 100,
  /** 每个字的显现时长（opacity + blur） */
  charDur: 420,
  /** 字间隔上限 */
  charStagger: 30,
  /** 提问从第一个字开始到最后一个字显现完毕的总时长上限 */
  questionCap: 900,
  ruleGap: 150,
  ruleDur: 400,
  /** 横屏左页风纹饰淡入 */
  ornamentDur: 600,
  /** 带图提问（15 §11.3）：提问显现后 100 ms，照片上的纱层 600 ms 淡去（显影），随后相角 200 ms 淡入（像把照片插进相角） */
  photoGap: 100,
  photoDur: 600,
  cornerDur: 200,
  itemsGap: 100,
  itemDur: 320,
  itemStagger: 90,
  /** 横屏：右页在左页的饰纹出现后多久开始 */
  spreadRightGap: 200,
  fillDur: 900,
  sealDur: 220,
  hintGap: 200,
  hintDur: 400,
  /** 减少动态效果：全部内容一起淡入 */
  reducedDur: 200,
  /** 再翻一次：反向淡出的总时长 */
  dissolveTotal: 500,
  dissolveDur: 260,
  /** 金尘（11 §5.1）：粒数 clamp(min, round(字数 × perChar), max)；在所选的字开始显现后 delay 出生 */
  dustMin: 8,
  dustMax: 18,
  dustPerChar: 0.6,
  dustDelay: 120,
  dustDurMin: 1400,
  dustDurMax: 2200,
} as const;

export interface Step {
  start: number;
  dur: number;
}

export interface QuestionTiming {
  start: number;
  stagger: number;
  charDur: number;
  /** 最后一个字显现完毕的时刻 */
  end: number;
}

/** 一粒金尘：出生时刻与时长（ms）、从哪个字升起、外观与轨迹的随机种子 */
export interface DustGrain {
  at: number;
  dur: number;
  charIndex: number;
  seed: number;
}

export interface RevealPlan {
  head: Step;
  question: QuestionTiming;
  /** 照片显影与相角（无图时为 null） */
  photo: Step | null;
  corners: Step | null;
  rule: Step;
  /** 每个 item（选项行、「风吟」小标题、提示页各块）的开始时刻 */
  items: Step[];
  fill: Step | null;
  seal: Step | null;
  hint: Step | null;
  /** ActionBar 应当淡入的时刻（11 §5 最后一行） */
  actionsCue: number;
  /** 金尘：不生成时为空（11 §5.1） */
  dust: DustGrain[];
  total: number;
}

export interface RevealInput {
  /** 提问的字素簇数（含前后直角引号） */
  chars: number;
  items: number;
  hasFill: boolean;
  hasSeal: boolean;
  hasHint: boolean;
  /** 带图提问：之后的时间依次顺延 */
  hasPhoto?: boolean;
  mode: BookMode;
  /** 金尘的随机种子；缺省时不生成（跳过、淡去、SSR 直达、减少动态效果、非答案页） */
  dustSeed?: number;
}

/**
 * 提问逐字显现的间隔：默认 30 ms；字多时自动缩短，使
 * `stagger × (n − 1) + charDur ≤ questionCap`。
 */
export function questionStagger(chars: number): number {
  if (chars <= 1) return 0;
  const budget = INK.questionCap - INK.charDur;
  return Math.min(INK.charStagger, budget / (chars - 1));
}

export function questionTiming(chars: number): QuestionTiming {
  const start = INK.questionStart;
  if (chars <= 0) return { start, stagger: 0, charDur: 0, end: start };
  const stagger = questionStagger(chars);
  return { start, stagger, charDur: INK.charDur, end: start + stagger * (chars - 1) + INK.charDur };
}

export function computeRevealPlan(input: RevealInput): RevealPlan {
  const head: Step = { start: 0, dur: INK.headDur };
  const question = questionTiming(input.chars);
  const photo: Step | null = input.hasPhoto
    ? { start: question.end + INK.photoGap, dur: INK.photoDur }
    : null;
  const corners: Step | null = photo ? { start: photo.start + photo.dur, dur: INK.cornerDur } : null;
  const afterQuestion = corners ? corners.start + corners.dur : question.end;
  const rule: Step = { start: afterQuestion + INK.ruleGap, dur: INK.ruleDur };

  // 竖屏：分割线展开完毕后再出选项；横屏：左页饰纹淡入的同时，右页开始显现
  const itemsStart =
    input.mode === 'spread' ? rule.start + INK.spreadRightGap : rule.start + rule.dur + INK.itemsGap;
  const items: Step[] = Array.from({ length: input.items }, (_, i) => ({
    start: itemsStart + i * INK.itemStagger,
    dur: INK.itemDur,
  }));
  const lastItemEnd =
    items.length > 0 ? (items[items.length - 1]?.start ?? itemsStart) + INK.itemDur : rule.start + rule.dur;

  const fill: Step | null = input.hasFill ? { start: lastItemEnd, dur: INK.fillDur } : null;
  const afterFill = fill ? fill.start + fill.dur : lastItemEnd;
  const seal: Step | null = input.hasSeal ? { start: afterFill, dur: INK.sealDur } : null;
  const afterSeal = seal ? seal.start + seal.dur : afterFill;
  const actionsCue = afterSeal + INK.hintGap;
  const hint: Step | null = input.hasHint ? { start: actionsCue, dur: INK.hintDur } : null;

  const ends = [head, photo, corners, rule, ...items, fill, seal, hint]
    .filter((s): s is Step => s !== null)
    .map((s) => s.start + s.dur);
  const total = Math.max(question.end, actionsCue, ...ends);
  // 带图提问不额外生成：照片显影本身就是一个「浮现」的节拍
  const dust =
    input.dustSeed === undefined || input.hasPhoto
      ? []
      : dustPlan(input.chars, question, total, input.dustSeed);
  return { head, question, photo, corners, rule, items, fill, seal, hint, actionsCue, dust, total };
}

/** mulberry32：小而稳定的种子随机数（金尘的轨迹也由各粒的 seed 经它展开） */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 金尘粒数：clamp(8, round(字数 × 0.6), 18)；没有字时不生成 */
export function dustCount(chars: number): number {
  if (chars <= 0) return 0;
  return Math.min(INK.dustMax, Math.max(INK.dustMin, Math.round(chars * INK.dustPerChar)));
}

/**
 * 金尘时间表：从提问的逐字 span 中均匀抽取（各段内随机一个字），在该字开始显现后 120 ms 出生；
 * 时长 1400–2200 ms，但最后一粒的结束不晚于 total（总时长不变）。
 */
function dustPlan(chars: number, q: QuestionTiming, total: number, seed: number): DustGrain[] {
  const n = dustCount(chars);
  const rand = seededRandom(seed);
  const grains: DustGrain[] = [];
  for (let i = 0; i < n; i++) {
    const charIndex = Math.min(chars - 1, Math.floor(((i + rand()) * chars) / n));
    const at = q.start + charIndex * q.stagger + INK.dustDelay;
    const dur = Math.min(INK.dustDurMin + rand() * (INK.dustDurMax - INK.dustDurMin), total - at);
    grains.push({ at, dur: Math.floor(dur), charIndex, seed: Math.floor(rand() * 2 ** 32) });
  }
  return grains;
}

/** 再翻一次：n 个块按相反顺序淡出，总时长约 500 ms */
export function dissolveStagger(blocks: number): number {
  if (blocks <= 1) return 0;
  return Math.max(0, (INK.dissolveTotal - INK.dissolveDur) / (blocks - 1));
}

/** 百分比递增：按填充条的进度（已缓动）取整 */
export function countUpValue(target: number, progress: number | null | undefined): number {
  if (progress == null || !Number.isFinite(progress)) return 0;
  const p = Math.min(1, Math.max(0, progress));
  return Math.round(target * p);
}
