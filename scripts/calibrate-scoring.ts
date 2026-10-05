// pnpm calibrate:scoring（03 §5）：对评测集生成选项后多次调用 JEV，比较 choice 与 blend 策略，
// 产出 reports/calibrate-scoring-<日期>.md，据此定稿 w、τ 与 JEV_MODEL。
// 参数：--limit N --repeat N（每题 JEV 调用次数，默认 3）--concurrency N（默认 2）--mock

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import {
  fmt,
  loadScriptEnv,
  mapLimit,
  parseScriptArgs,
  quantile,
  scrubSecrets,
  today,
} from '../src/server/scriptEnv';

loadScriptEnv();
const args = parseScriptArgs(process.argv.slice(2));
if (args.mock) process.env.MOCK_UPSTREAMS = 'true';
process.env.MOCK_LATENCY_MS ??= '50';
process.env.LOG_LEVEL = process.env.EVAL_LOG_LEVEL ?? 'error';

const { generateOptions } = await import('../src/server/llm/generateOptions');
const { buildJevRequest } = await import('../src/server/jev/buildRequest');
const { callJev } = await import('../src/server/jev/client');
const { computeScoring } = await import('../src/server/jev/scoring');
const { SCORING_VERSION } = await import('../src/server/jev/questions');
const { getConfig } = await import('../src/server/config');
const { UpstreamError } = await import('../src/server/http/errors');

type Quad = [number, number, number, number];
type Answers = Parameters<typeof computeScoring>[0];

interface Fixture {
  id: string;
  category: string;
  expect: string;
  question: string;
  image?: string;
}

// --vision：改用带图评测集（15 §9、§16.3），JEV 的 state 含 image，报告为 calibrate-scoring-vision-<日期>.md
const vision = process.argv.includes('--vision');
const visionMod = vision ? await import('./vision-fixtures') : null;

interface Sample {
  fixture: Fixture;
  titles: string[];
  calls: { answers: Answers; latencyMs: number }[];
  errors: string[];
}

const cfg = getConfig();
const repeat = args.repeat ?? 3;
const fixtures = (
  visionMod
    ? (visionMod.loadVisionFixtures() as Fixture[])
    : (JSON.parse(readFileSync('tests/fixtures/questions.zh.json', 'utf8')) as Fixture[])
)
  .filter((f) => f.expect === 'ok')
  .slice(0, args.limit);
console.log(
  `校准 ${fixtures.length} 题 × JEV ${repeat} 次，JEV_MODEL=${cfg.jev.model}${cfg.mock.enabled ? '（MOCK）' : ''}`,
);

let done = 0;
const samples = await mapLimit(fixtures, args.concurrency, async (fixture): Promise<Sample> => {
  const s: Sample = { fixture, titles: [], calls: [], errors: [] };
  try {
    const image = visionMod ? { dataUrl: await visionMod.fixtureDataUrl(fixture) } : undefined;
    const llm = await generateOptions({
      question: fixture.question,
      image,
      deadline: Date.now() + cfg.readingDeadlineMs,
    });
    if (llm.status !== 'ok') {
      s.errors.push(`llm:${llm.status}`);
      return s;
    }
    s.titles = llm.options.map((o) => o.title);
    const req = buildJevRequest({
      model: cfg.jev.model,
      question: fixture.question,
      questionEn: llm.questionEn,
      briefsEn: llm.options.map((o) => o.briefEn) as [string, string, string, string],
      imageEn: llm.imageEn,
    });
    for (let i = 0; i < repeat; i++) {
      const t0 = Date.now();
      try {
        const r = await callJev(req, { deadline: Date.now() + 30_000 });
        s.calls.push({ answers: r.response.answers, latencyMs: Date.now() - t0 });
      } catch (e) {
        s.errors.push(e instanceof UpstreamError ? `jev:${e.kind}:${e.status ?? ''}` : 'jev:internal');
      }
    }
  } catch (e) {
    s.errors.push(e instanceof UpstreamError ? `llm:${e.kind}:${e.status ?? ''}` : 'internal');
  }
  done++;
  process.stdout.write(`\r${done}/${fixtures.length}`);
  return s;
});
process.stdout.write('\n');

// ---- 统计工具 ----
const entropy = (p: readonly number[]) =>
  -p.reduce((a, x) => a + (x > 0 ? x * Math.log(x) : 0), 0) / Math.log(p.length);
function ranks(xs: readonly number[]): number[] {
  const idx = xs.map((x, i) => ({ x, i })).sort((a, b) => a.x - b.x);
  const r = new Array<number>(xs.length);
  for (let k = 0; k < idx.length; ) {
    let j = k;
    while (j + 1 < idx.length && idx[j + 1]!.x === idx[k]!.x) j++;
    for (let m = k; m <= j; m++) r[idx[m]!.i] = (k + j) / 2 + 1;
    k = j + 1;
  }
  return r;
}
function spearman(a: readonly number[], b: readonly number[]): number {
  const ra = ranks(a);
  const rb = ranks(b);
  const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
  const ma = mean(ra);
  const mb = mean(rb);
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < ra.length; i++) {
    num += (ra[i]! - ma) * (rb[i]! - mb);
    da += (ra[i]! - ma) ** 2;
    db += (rb[i]! - mb) ** 2;
  }
  return da === 0 || db === 0 ? Number.NaN : num / Math.sqrt(da * db);
}
const std = (xs: readonly number[]) => {
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / xs.length);
};
const argmax = (p: readonly number[]) => p.indexOf(Math.max(...p));

const params = cfg.scoring;
const calls = samples.flatMap((s) => s.calls.map((c) => ({ s, c })));
const computed = calls.flatMap(({ s, c }) => {
  try {
    return [
      {
        s,
        blend: computeScoring(c.answers, { ...params, strategy: 'blend' }),
        choice: computeScoring(c.answers, { ...params, strategy: 'choice' }),
        latencyMs: c.latencyMs,
      },
    ];
  } catch {
    return [];
  }
});

const agreement = computed.filter((x) => x.blend.positionAgreement).length / Math.max(1, computed.length);
const maxChoice = computed.map((x) => Math.max(...x.choice.probs));
const maxBlend = computed.map((x) => Math.max(...x.blend.probs));
const entChoice = computed.map((x) => entropy(x.choice.probs));
const entBlend = computed.map((x) => entropy(x.blend.probs));
const rhos = computed.map((x) => spearman(x.blend.choice, x.blend.fit)).filter(Number.isFinite);
const topSame = computed.filter((x) => argmax(x.blend.probs) === argmax(x.choice.probs)).length;
const zeroish = computed.filter((x) => x.choice.probs.filter((p) => p < 0.01).length >= 2).length;

const stability = samples
  .filter((s) => s.calls.length >= 2)
  .map((s) => {
    const probs = s.calls.flatMap((c) => {
      try {
        return [computeScoring(c.answers, { ...params, strategy: 'blend' }).probs as Quad];
      } catch {
        return [];
      }
    });
    if (probs.length < 2) return Number.NaN;
    return [0, 1, 2, 3].map((k) => std(probs.map((p) => p[k]!))).reduce((a, b) => a + b, 0) / 4;
  })
  .filter(Number.isFinite);

const dist = (xs: number[]) =>
  `${fmt(quantile(xs, 0.1))} / ${fmt(quantile(xs, 0.25))} / **${fmt(quantile(xs, 0.5))}** / ${fmt(quantile(xs, 0.75))} / ${fmt(quantile(xs, 0.9))}`;

// 参数网格：最大占比的中位数（目标 0.40–0.65）
const W = [0.4, 0.5, 0.6, 0.7, 0.8];
const TAU = [0.15, 0.2, 0.25, 0.35, 0.5];
const grid = TAU.map((tau) =>
  W.map((w) => {
    const xs = calls.flatMap(({ c }) => {
      try {
        return [
          Math.max(
            ...computeScoring(c.answers, { strategy: 'blend', blendWeight: w, softmaxTau: tau }).probs,
          ),
        ];
      } catch {
        return [];
      }
    });
    return quantile(xs, 0.5);
  }),
);

const L: string[] = [];
L.push(`# 评分校准报告${vision ? '（带图）' : ''} · ${today()}`);
L.push('');
L.push(
  `- JEV_MODEL：\`${cfg.jev.model}\`${cfg.mock.enabled ? '（MOCK，仅演练脚本）' : ''}；LLM：\`${cfg.llm.model}\``,
);
L.push(`- 评分版本：\`${SCORING_VERSION}\`；当前参数：w = ${params.blendWeight}，τ = ${params.softmaxTau}`);
L.push(
  `- 样本：${fixtures.length} 题 × ${repeat} 次 = ${calls.length} 次有效 JEV 响应（可融合 ${computed.length}）`,
);
const errors = samples.flatMap((s) => s.errors);
if (errors.length > 0) L.push(`- 错误：${errors.length} 次（${[...new Set(errors)].join('，')}）`);
L.push('');
L.push('## 位置偏差与相关性');
L.push('');
L.push('| 指标 | 结果 | 说明 |');
L.push('|---|---|---|');
L.push(`| fwd / rev 首选一致率 | ${(agreement * 100).toFixed(1)}% | ≥ 97% 时可考虑去掉 best_rev |`);
L.push(
  `| c 与 s 的 Spearman（均值） | ${fmt(rhos.reduce((a, b) => a + b, 0) / Math.max(1, rhos.length))} | 两类信号是否一致 |`,
);
L.push(`| blend 与 choice 首选相同 | ${pct(topSame, computed.length)} | |`);
L.push(`| choice 下 ≥ 2 项 < 1% | ${pct(zeroish, computed.length)} | 分布过度集中的比例 |`);
L.push(
  `| 同输入多次调用 blend 占比的标准差（均值） | ${fmt(stability.reduce((a, b) => a + b, 0) / Math.max(1, stability.length), 3)} | 稳定性 |`,
);
L.push(
  `| JEV 延迟 p50 / p95 | ${fmt(
    quantile(
      computed.map((x) => x.latencyMs),
      0.5,
    ) / 1000,
  )} s / ${fmt(
    quantile(
      computed.map((x) => x.latencyMs),
      0.95,
    ) / 1000,
  )} s | 验收：p95 ≤ 1.5 s |`,
);
L.push('');
L.push('## 最大占比与熵的分布（p10 / p25 / 中位 / p75 / p90）');
L.push('');
L.push('| 策略 | 最大占比 | 归一化熵 |');
L.push('|---|---|---|');
L.push(`| choice | ${dist(maxChoice)} | ${dist(entChoice)} |`);
L.push(
  `| blend（w=${params.blendWeight}, τ=${params.softmaxTau}） | ${dist(maxBlend)} | ${dist(entBlend)} |`,
);
L.push('');
L.push('## 参数网格：blend 最大占比的中位数（目标 0.40–0.65）');
L.push('');
L.push(`| τ \\ w | ${W.join(' | ')} |`);
L.push(`|---|${W.map(() => '---').join('|')}|`);
TAU.forEach((tau, i) => {
  L.push(
    `| ${tau} | ${grid[i]!.map((v) => (v >= 0.4 && v <= 0.65 ? `**${fmt(v)}**` : fmt(v))).join(' | ')} |`,
  );
});
L.push('');
L.push('## 逐题结果（blend，按 LLM 原始顺序；多次调用取均值）');
L.push('');
L.push('| id | 选项 | p（均值） | c | s | 一致 |');
L.push('|---|---|---|---|---|---|');
for (const s of samples) {
  const cs = computed.filter((x) => x.s === s);
  if (cs.length === 0) {
    L.push(`| ${s.fixture.id} | — | — | — | — | ${s.errors.join(' ')} |`);
    continue;
  }
  const avg = (get: (x: (typeof cs)[number]) => readonly number[]) =>
    [0, 1, 2, 3].map((k) => cs.reduce((a, x) => a + get(x)[k]!, 0) / cs.length);
  const p = avg((x) => x.blend.probs);
  const c = avg((x) => x.blend.choice);
  const f = avg((x) => x.blend.fit);
  L.push(
    `| ${s.fixture.id} | ${s.titles.join(' · ')} | ${p.map((v) => fmt(v)).join(' ')} | ${c.map((v) => fmt(v)).join(' ')} | ${f.map((v) => fmt(v)).join(' ')} | ${cs.filter((x) => x.blend.positionAgreement).length}/${cs.length} |`,
  );
}
L.push('');
L.push('## 人工排序对照（评审填写）');
L.push('');
L.push(
  '挑 10 题，请 2–3 人为选项排序（1 = 最推荐），再计算与 choice / blend 排序的 Kendall τ，比较首选一致率。',
);
L.push('');
L.push('| id | 选项（LLM 原始顺序） | 评审 1 | 评审 2 | 评审 3 |');
L.push('|---|---|---|---|---|');
for (const s of samples.filter((x) => x.titles.length === 4).slice(0, 10)) {
  L.push(`| ${s.fixture.id} | ${s.titles.map((t, i) => `${i + 1}. ${t}`).join('<br>')} | | | |`);
}
L.push('');
L.push('## 结论（校准后填写并写回 03 §3.3）');
L.push('');
L.push('- w = ？，τ = ？，理由：');
L.push('- 是否保留 best_rev：');
L.push('- 是否保留 question_original：');

function pct(n: number, d: number): string {
  return d === 0 ? '—' : `${((n / d) * 100).toFixed(1)}%`;
}

mkdirSync('reports', { recursive: true });
const out = `reports/calibrate-scoring-${vision ? 'vision-' : ''}${today()}${cfg.mock.enabled ? '-mock' : ''}.md`;
writeFileSync(out, scrubSecrets(L.join('\n')));
console.log(`报告：${out}`);
console.log(
  `fwd/rev 一致率 ${(agreement * 100).toFixed(1)}%，blend 最大占比中位数 ${fmt(quantile(maxBlend, 0.5))}，choice ${fmt(quantile(maxChoice, 0.5))}`,
);
