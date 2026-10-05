import { CHOICE_INSTRUCTIONS, FIT_LEVELS, FIT_QUESTION, OPTION_KEYS } from './questions';
import type { JevQuestion, JevRequest } from './types';

// 一次请求、六个问题（03 §3.1–§3.2）

export const MAX_BRIEF_CHARS = 500;
export const MAX_QUESTION_CHARS = 1200;
/** 图片的英文描述（15 §9） */
export const MAX_IMAGE_CHARS = 800;

export type Briefs = readonly [string, string, string, string];

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) : s);

export function buildJevRequest(input: {
  model: string;
  question: string;
  questionEn: string;
  briefsEn: Briefs;
  /** 带图提问：LLM 写出的图片英文描述，JEV 通过它「看到」图片（15 §9） */
  imageEn?: string;
}): JevRequest {
  const briefs = input.briefsEn.map((b) => clip(b, MAX_BRIEF_CHARS));
  const fwd: Record<string, string> = {};
  const rev: Record<string, string> = {};
  OPTION_KEYS.forEach((k, i) => {
    fwd[k] = briefs[i]!;
  });
  [...OPTION_KEYS].reverse().forEach((k) => {
    rev[k] = briefs[OPTION_KEYS.indexOf(k)]!;
  });

  const questions: Record<string, JevQuestion> = {
    best_fwd: { type: 'choice', instructions: CHOICE_INSTRUCTIONS, criteria: fwd },
    best_rev: { type: 'choice', instructions: CHOICE_INSTRUCTIONS, criteria: rev },
  };
  OPTION_KEYS.forEach((k, i) => {
    questions[`fit_${k}`] = {
      type: 'score',
      instructions: { question: FIT_QUESTION, option: briefs[i]! },
      criteria: [...FIT_LEVELS],
    };
  });

  return {
    model: input.model,
    state: {
      question: clip(input.questionEn, MAX_QUESTION_CHARS),
      question_original: clip(input.question, MAX_QUESTION_CHARS),
      // 无图时不出现该键，文字提问的请求体逐字节不变
      ...(input.imageEn ? { image: clip(input.imageEn, MAX_IMAGE_CHARS) } : {}),
    },
    questions,
  };
}

/** 日志用：脱敏后的请求体（不含提问原文与选项文本，只保留结构与长度） */
export function redactJevRequest(req: JevRequest): Record<string, unknown> {
  const questions = Object.fromEntries(
    Object.entries(req.questions).map(([k, q]) => [
      k,
      {
        type: q.type,
        criteria:
          q.type === 'choice'
            ? Object.fromEntries(
                Object.entries(q.criteria).map(([ck, cv]) => [ck, `<${String(cv ?? '').length} chars>`]),
              )
            : q.type === 'score'
              ? `<${q.criteria.length} levels>`
              : undefined,
      },
    ]),
  );
  return { model: req.model, stateKeys: Object.keys(req.state as object), questions };
}
