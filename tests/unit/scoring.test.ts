import { describe, expect, it } from 'vitest';
import { toPercents } from '@/lib/shared/percent';
import { computeScoring, InvalidJevAnswers, type ScoringParams, softmax } from '@/server/jev/scoring';
import type { JevAnswer } from '@/server/jev/types';

const BLEND: ScoringParams = { strategy: 'blend', blendWeight: 0.6, softmaxTau: 0.25 };

function choice(probs: Record<string, number>, conf = 0.5): JevAnswer {
  const top = Object.entries(probs).sort((a, b) => b[1] - a[1])[0]![0];
  return { type: 'choice', choice: top, confidence: conf, probabilities: probs };
}
function score(s: number): JevAnswer {
  return { type: 'score', score: s, confidence: 0.5, probabilities: { '0': 1 } };
}
function answers(
  c: [number, number, number, number],
  s: [number, number, number, number],
  rev?: [number, number, number, number],
): Record<string, JevAnswer> {
  const r = rev ?? c;
  return {
    best_fwd: choice({ o1: c[0], o2: c[1], o3: c[2], o4: c[3] }),
    best_rev: choice({ o4: r[3], o3: r[2], o2: r[1], o1: r[0] }),
    fit_o1: score(s[0]),
    fit_o2: score(s[1]),
    fit_o3: score(s[2]),
    fit_o4: score(s[3]),
  };
}

describe('computeScoring（03 §3.3）', () => {
  it('文档示例 1：c=(.55,.15,.25,.05)、score=(3.2,2.1,2.9,1.5) → 51/15/28/6', () => {
    const r = computeScoring(answers([0.55, 0.15, 0.25, 0.05], [3.2, 2.1, 2.9, 1.5]), BLEND);
    const q = softmax(r.fit, 0.25);
    expect(q[0]).toBeCloseTo(0.443, 3);
    expect(q[1]).toBeCloseTo(0.148, 3);
    expect(q[2]).toBeCloseTo(0.328, 3);
    expect(q[3]).toBeCloseTo(0.081, 3);
    expect(r.probs[0]).toBeCloseTo(0.507, 3);
    expect(r.probs[1]).toBeCloseTo(0.149, 3);
    expect(r.probs[2]).toBeCloseTo(0.281, 3);
    expect(r.probs[3]).toBeCloseTo(0.062, 3);
    expect(toPercents(r.probs)).toEqual([51, 15, 28, 6]);
  });

  it('文档示例 2：choice 退化为 (1,0,0,0) 时 → 76/10/8/6，而不是 100/0/0/0', () => {
    const r = computeScoring(answers([1, 0, 0, 0], [3.5, 3.0, 2.8, 2.5]), BLEND);
    expect(r.probs[0]).toBeCloseTo(0.762, 3);
    expect(r.probs[1]).toBeCloseTo(0.098, 3);
    expect(r.probs[2]).toBeCloseTo(0.08, 3);
    expect(r.probs[3]).toBeCloseTo(0.06, 3);
    expect(toPercents(r.probs)).toEqual([76, 10, 8, 6]);
  });

  it('正序与反序取平均，并记录位置一致性与置信度', () => {
    const r = computeScoring(answers([0.7, 0.1, 0.1, 0.1], [2, 2, 2, 2], [0.1, 0.1, 0.1, 0.7]), BLEND);
    for (const [i, v] of [0.4, 0.1, 0.1, 0.4].entries()) expect(r.choice[i]).toBeCloseTo(v, 12);
    expect(r.positionAgreement).toBe(false);
    expect(r.confidence).toBe(0.5);
    expect(r.probs.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
  });

  it('choice 策略：p = c', () => {
    const r = computeScoring(answers([0.55, 0.15, 0.25, 0.05], [3.2, 2.1, 2.9, 1.5]), {
      ...BLEND,
      strategy: 'choice',
    });
    expect(r.probs.map((p) => Number(p.toFixed(6)))).toEqual([0.55, 0.15, 0.25, 0.05]);
  });

  it('概率防御性归一化；缺失的键按 0 计', () => {
    const a = answers([0, 0, 0, 0], [2, 2, 2, 2]);
    a.best_fwd = choice({ o1: 2, o2: 2 }); // 和为 4，缺 o3/o4
    a.best_rev = choice({ o1: 0.5, o2: 0.5 });
    const r = computeScoring(a, BLEND);
    for (const [i, v] of [0.5, 0.5, 0, 0].entries()) expect(r.choice[i]).toBeCloseTo(v, 12);
  });

  it('非法响应抛出 InvalidJevAnswers（可重试）', () => {
    const base = () => answers([0.25, 0.25, 0.25, 0.25], [2, 2, 2, 2]);
    const missing = base();
    delete missing.fit_o4;
    expect(() => computeScoring(missing, BLEND)).toThrow(InvalidJevAnswers);

    const wrongType = base();
    wrongType.best_fwd = score(2);
    expect(() => computeScoring(wrongType, BLEND)).toThrow(InvalidJevAnswers);

    const zero = base();
    zero.best_rev = choice({ o1: 0, o2: 0, o3: 0, o4: 0 });
    expect(() => computeScoring(zero, BLEND)).toThrow(/sums to 0/);

    const nan = base();
    nan.best_fwd = choice({ o1: Number.NaN, o2: 1, o3: 0, o4: 0 });
    expect(() => computeScoring(nan, BLEND)).toThrow(InvalidJevAnswers);

    const extraKey = base();
    extraKey.best_fwd = choice({ o1: 0.5, o5: 0.5 });
    expect(() => computeScoring(extraKey, BLEND)).toThrow(/unexpected keys/);

    const outOfRange = base();
    outOfRange.fit_o2 = score(4.5);
    expect(() => computeScoring(outOfRange, BLEND)).toThrow(/out of range/);
  });
});
