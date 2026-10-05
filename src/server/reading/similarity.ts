// 字符二元组 Jaccard 相似度（02 §6、§12）：用于「再翻一次」的新旧标题对比与评测中的选项去重。

const STRIP = /[\s\p{P}\p{S}]/gu;

export function bigrams(text: string): Set<string> {
  const chars = Array.from(text.replace(STRIP, '').toLowerCase());
  const out = new Set<string>();
  if (chars.length === 1) out.add(chars[0]!);
  for (let i = 0; i + 1 < chars.length; i++) out.add(chars[i]! + chars[i + 1]!);
  return out;
}

export function jaccard(a: string, b: string): number {
  const A = bigrams(a);
  const B = bigrams(b);
  if (A.size === 0 && B.size === 0) return 1;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}

export const HIGH_SIMILARITY = 0.6;

/** 新标题中，与任一旧标题相似度 > 0.6 的条数，以及最大相似度 */
export function regenSimilarity(
  next: readonly string[],
  previous: readonly string[],
): { similarCount: number; maxSimilarity: number } {
  let similarCount = 0;
  let maxSimilarity = 0;
  for (const n of next) {
    const best = Math.max(0, ...previous.map((p) => jaccard(n, p)));
    if (best > HIGH_SIMILARITY) similarCount++;
    maxSimilarity = Math.max(maxSimilarity, best);
  }
  return { similarCount, maxSimilarity: Number(maxSimilarity.toFixed(3)) };
}

/** 同一组内两两相似度的最大值（评测用） */
export function maxPairwiseSimilarity(titles: readonly string[]): number {
  let max = 0;
  for (let i = 0; i < titles.length; i++) {
    for (let j = i + 1; j < titles.length; j++) max = Math.max(max, jaccard(titles[i]!, titles[j]!));
  }
  return max;
}
