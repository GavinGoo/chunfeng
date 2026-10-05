import { toPercents } from '@/lib/shared/percent';
import { OPTION_LETTERS, type ReadingOption } from '@/lib/shared/types';

// 排序、字母与百分比（03 §3.4）

const EPS = 1e-12;

export interface RankInput {
  options: readonly { title: string; desc: string }[]; // LLM 原始顺序
  probs: readonly number[]; // p_k
  fit: readonly number[]; // s_k
}

/** 返回按 p 降序排列的选项（并列时 s 降序，再按 LLM 原始顺序升序），以及对应的原始下标 */
export function rankOptions(input: RankInput): { options: ReadingOption[]; order: number[] } {
  const order = input.options
    .map((_, i) => i)
    .sort((a, b) => {
      const dp = (input.probs[b] ?? 0) - (input.probs[a] ?? 0);
      if (Math.abs(dp) > EPS) return dp;
      const ds = (input.fit[b] ?? 0) - (input.fit[a] ?? 0);
      if (Math.abs(ds) > EPS) return ds;
      return a - b;
    });
  const sortedProbs = order.map((i) => input.probs[i] ?? 0);
  const pcts = toPercents(sortedProbs);
  const options = order.map((i, rank) => {
    const o = input.options[i]!;
    return {
      letter: OPTION_LETTERS[rank]!,
      title: o.title,
      desc: o.desc,
      prob: sortedProbs[rank]!,
      pct: pcts[rank]!,
    };
  });
  return { options, order };
}
