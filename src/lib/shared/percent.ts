// 最大余数法取整：四项之和恰为 100（03 §3.4），前后端共用

export function toPercents(probs: readonly number[]): number[] {
  if (probs.length === 0) return [];
  const safe = probs.map((p) => (Number.isFinite(p) && p > 0 ? p : 0));
  const total = safe.reduce((a, b) => a + b, 0);
  const norm = total > 0 ? safe.map((p) => p / total) : safe.map(() => 1 / safe.length);
  const raw = norm.map((p) => p * 100);
  const floors = raw.map((r) => Math.floor(r + 1e-9));
  let remainder = 100 - floors.reduce((a, b) => a + b, 0);
  // 差额按小数部分从大到小分配；并列时概率大者优先，再按原始顺序
  const order = raw
    .map((r, i) => ({ i, frac: r - (floors[i] ?? 0), p: norm[i] ?? 0 }))
    .sort((a, b) => (Math.abs(b.frac - a.frac) > 1e-9 ? b.frac - a.frac : 0) || b.p - a.p || a.i - b.i);
  const out = [...floors];
  for (let k = 0; remainder > 0; k = (k + 1) % order.length, remainder--) {
    const idx = order[k]!.i;
    out[idx] = (out[idx] ?? 0) + 1;
  }
  return out;
}

/** 展示用：pct 为 0 但概率大于 0 时显示「<1%」 */
export function formatPct(pct: number, prob: number): string {
  return pct === 0 && prob > 0 ? '<1%' : `${pct}%`;
}
