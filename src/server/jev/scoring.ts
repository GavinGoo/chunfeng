import { getConfig } from '../config';
import { UpstreamError } from '../http/errors';
import { log } from '../log';
import { type Briefs, buildJevRequest } from './buildRequest';
import { callJev } from './client';
import { FIT_MAX, OPTION_KEYS, SCORING_VERSION } from './questions';
import type { JevAnswer, JevResponse } from './types';

// 解析、校验、融合与置信度（03 §3.3–§3.5）

export type Quad = [number, number, number, number];

export interface ScoringParams {
  strategy: 'blend' | 'choice';
  blendWeight: number; // w
  softmaxTau: number; // τ
}

export interface ScoringComputation {
  probs: Quad; // p_k，按 o1–o4，Σ = 1
  fit: Quad; // s_k ∈ [0, 1]
  choice: Quad; // c_k，Σ = 1
  confidence: number;
  positionAgreement: boolean;
}

export class InvalidJevAnswers extends Error {
  constructor(detail: string) {
    super(`invalid JEV answers: ${detail}`);
    this.name = 'InvalidJevAnswers';
  }
}

function choiceProbs(
  answer: JevAnswer | undefined,
  name: string,
): { probs: Quad; top: string; confidence: number } {
  if (answer?.type !== 'choice') throw new InvalidJevAnswers(`${name} missing or not choice`);
  const keys = Object.keys(answer.probabilities);
  if (keys.some((k) => !(OPTION_KEYS as readonly string[]).includes(k))) {
    throw new InvalidJevAnswers(`${name} has unexpected keys`);
  }
  const raw = OPTION_KEYS.map((k) => answer.probabilities[k] ?? 0);
  if (raw.some((p) => !Number.isFinite(p) || p < 0))
    throw new InvalidJevAnswers(`${name} has invalid values`);
  const sum = raw.reduce((a, b) => a + b, 0);
  if (!(sum > 0)) throw new InvalidJevAnswers(`${name} sums to 0`);
  return {
    probs: raw.map((p) => p / sum) as Quad,
    top: answer.choice,
    confidence: Number.isFinite(answer.confidence) ? answer.confidence : 0,
  };
}

function fitScore(answer: JevAnswer | undefined, name: string): number {
  if (answer?.type !== 'score') throw new InvalidJevAnswers(`${name} missing or not score`);
  const s = answer.score;
  if (!Number.isFinite(s) || s < -1e-6 || s > FIT_MAX + 1e-6)
    throw new InvalidJevAnswers(`${name} out of range`);
  return Math.min(FIT_MAX, Math.max(0, s)) / FIT_MAX;
}

export function softmax(xs: readonly number[], tau: number): number[] {
  const m = Math.max(...xs);
  const ex = xs.map((x) => Math.exp((x - m) / tau));
  const sum = ex.reduce((a, b) => a + b, 0);
  return ex.map((e) => e / sum);
}

/** 纯函数：从 JEV 的六个答案计算融合概率 */
export function computeScoring(
  answers: Record<string, JevAnswer>,
  params: ScoringParams,
): ScoringComputation {
  const fwd = choiceProbs(answers.best_fwd, 'best_fwd');
  const rev = choiceProbs(answers.best_rev, 'best_rev');
  const choice = fwd.probs.map((p, i) => (p + rev.probs[i]!) / 2) as Quad;
  const fit = OPTION_KEYS.map((k) => fitScore(answers[`fit_${k}`], `fit_${k}`)) as Quad;

  let probs: Quad;
  if (params.strategy === 'choice') {
    probs = choice;
  } else {
    const q = softmax(fit, params.softmaxTau);
    const w = params.blendWeight;
    probs = choice.map((c, i) => w * c + (1 - w) * q[i]!) as Quad;
  }
  const sum = probs.reduce((a, b) => a + b, 0);
  probs = probs.map((p) => p / sum) as Quad;

  return {
    probs,
    fit,
    choice,
    confidence: (fwd.confidence + rev.confidence) / 2,
    positionAgreement: fwd.top === rev.top,
  };
}

export interface ScoreOptionsInput {
  question: string;
  questionEn: string;
  briefsEn: Briefs;
  imageEn?: string;
  deadline: number;
  signal?: AbortSignal;
}

export interface ScoreOptionsResult extends ScoringComputation {
  raw: JevResponse['answers'];
  meta: {
    model: string;
    attempts: number;
    latencyMs: number;
    usage: JevResponse['usage'];
    strategy: string;
    version: string;
    params: ScoringParams;
    upstreamRequestId?: string;
  };
}

/** 调用 JEV 并融合；答案校验失败时最多再请求 1 次 */
export async function scoreOptions(input: ScoreOptionsInput): Promise<ScoreOptionsResult> {
  const cfg = getConfig();
  const params: ScoringParams = { ...cfg.scoring };
  const req = buildJevRequest({
    model: cfg.jev.model,
    question: input.question,
    questionEn: input.questionEn,
    briefsEn: input.briefsEn,
    imageEn: input.imageEn,
  });
  const started = Date.now();
  let attempts = 0;

  for (let round = 1; round <= 2; round++) {
    let res: Awaited<ReturnType<typeof callJev>>;
    try {
      res = await callJev(req, { deadline: input.deadline, signal: input.signal });
    } catch (e) {
      if (e instanceof UpstreamError) {
        e.attempts += attempts;
        if (e.kind === 'BAD_OUTPUT' && round === 1) {
          attempts = e.attempts;
          continue;
        }
      }
      throw e;
    }
    attempts += res.attempts;
    try {
      const computed = computeScoring(res.response.answers, params);
      return {
        ...computed,
        raw: res.response.answers,
        meta: {
          model: res.response.model,
          attempts,
          latencyMs: Date.now() - started,
          usage: res.response.usage,
          strategy: params.strategy,
          version: SCORING_VERSION,
          params,
          upstreamRequestId: res.upstreamRequestId,
        },
      };
    } catch (e) {
      if (!(e instanceof InvalidJevAnswers)) throw e;
      log().warn({
        evt: 'jev.bad_answers',
        round,
        detail: e.message,
        upstreamRequestId: res.upstreamRequestId,
      });
    }
  }
  throw new UpstreamError({ source: 'jev', kind: 'BAD_OUTPUT', retryable: true, attempts });
}
