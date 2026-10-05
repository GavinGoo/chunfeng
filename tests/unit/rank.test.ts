import { describe, expect, it } from 'vitest';
import { rankOptions } from '@/server/reading/rank';
import { jaccard, maxPairwiseSimilarity, regenSimilarity } from '@/server/reading/similarity';

const opts = ['甲', '乙', '丙', '丁'].map((t) => ({ title: t, desc: `${t}的说明` }));

describe('rankOptions（03 §3.4）', () => {
  it('按 p 降序分配 A–D，pct 和为 100', () => {
    const { options, order } = rankOptions({
      options: opts,
      probs: [0.507, 0.149, 0.281, 0.063],
      fit: [0.8, 0.5, 0.7, 0.4],
    });
    expect(options.map((o) => o.letter)).toEqual(['A', 'B', 'C', 'D']);
    expect(options.map((o) => o.title)).toEqual(['甲', '丙', '乙', '丁']);
    expect(order).toEqual([0, 2, 1, 3]);
    expect(options.reduce((a, o) => a + o.pct, 0)).toBe(100);
    expect(options[0]!.prob).toBe(0.507);
  });

  it('p 并列时按 s 降序，再按 LLM 原始顺序', () => {
    const { order } = rankOptions({
      options: opts,
      probs: [0.25, 0.25, 0.25, 0.25],
      fit: [0.5, 0.75, 0.5, 0.75],
    });
    expect(order).toEqual([1, 3, 0, 2]);
  });
});

describe('相似度（二元组 Jaccard）', () => {
  it('相同为 1，完全不同为 0', () => {
    expect(jaccard('先谈加薪，再定去留', '先谈加薪再定去留')).toBe(1);
    expect(jaccard('接下邀约', '留在原地')).toBe(0);
  });

  it('再翻一次的相似条数', () => {
    const r = regenSimilarity(['接下创业公司的邀约', '去海边走走'], ['接下创业公司邀约', '留在原公司']);
    expect(r.similarCount).toBe(1);
    expect(r.maxSimilarity).toBeGreaterThan(0.6);
  });

  it('组内两两最大相似度', () => {
    expect(maxPairwiseSimilarity(['甲乙丙', '丁戊己'])).toBe(0);
  });
});
