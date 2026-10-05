import { z } from 'zod';

// LLM 输出校验与后处理（02 §8）。校验宽于 prompt 中的长度要求。

const OptionSchema = z.object({
  title: z.string().trim().min(2).max(40),
  desc: z.string().trim().min(20).max(400),
  brief_en: z.string().trim().min(10).max(500),
});

/** 标题规范化：去空白与标点，用于去重 */
export function titleKey(title: string): string {
  return title.replace(/[\s\p{P}\p{S}]/gu, '').toLowerCase();
}

export const LlmOutputSchema = z
  .object({
    status: z.enum(['ok', 'unclear', 'sensitive', 'refused']),
    message: z.string().trim().max(200).default(''),
    question_en: z.string().trim().max(600).default(''),
    options: z.array(z.unknown()).default([]),
    // 带图提问（15 §8.3）：缺省为空字符串，文字提问的输出不受影响
    image_en: z.string().trim().max(800).default(''),
    image_alt: z.string().trim().max(120).default(''),
  })
  .superRefine((v, ctx) => {
    if (v.status === 'ok') {
      if (v.options.length !== 4) {
        ctx.addIssue({ code: 'custom', path: ['options'], message: 'options must have exactly 4 items' });
        return;
      }
      const keys = new Set<string>();
      v.options.forEach((o, i) => {
        const r = OptionSchema.safeParse(o);
        if (!r.success) {
          for (const issue of r.error.issues) {
            ctx.addIssue({ code: 'custom', path: ['options', i, ...issue.path], message: issue.message });
          }
          return;
        }
        const key = titleKey(r.data.title);
        if (keys.has(key))
          ctx.addIssue({ code: 'custom', path: ['options', i, 'title'], message: 'duplicate title' });
        keys.add(key);
      });
      if (!v.question_en)
        ctx.addIssue({ code: 'custom', path: ['question_en'], message: 'question_en required' });
    } else if (!v.message) {
      ctx.addIssue({ code: 'custom', path: ['message'], message: 'message required when status != ok' });
    }
  });

export interface LlmOption {
  title: string;
  desc: string;
  briefEn: string;
}

export type LlmParsed =
  | { status: 'ok'; questionEn: string; options: LlmOption[]; imageEn?: string; imageAlt?: string }
  | { status: 'unclear' | 'sensitive' | 'refused'; message: string };

const QUOTES = /^[「」『』“”‘’"'\s]+|[「」『』“”‘’"'\s]+$/g;
const TRAILING_PUNCT = /[。．.！!？?，,；;：:、\s]+$/u;

export function cleanTitle(title: string): string {
  let t = title.replace(/\s+/g, ' ').trim();
  t = t.replace(QUOTES, '');
  t = t.replace(TRAILING_PUNCT, '');
  return t.replace(QUOTES, '').trim();
}

export function cleanDesc(desc: string): string {
  return desc
    .replace(/\*\*/g, '')
    .replace(/^\s*#+\s*/gm, '')
    .replace(/^\s*-\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export type ParseResult =
  | { ok: true; value: LlmParsed }
  | { ok: false; reason: 'empty' | 'json'; detail: string }
  | { ok: false; reason: 'schema'; detail: string };

/** image_alt 的上限：40 个字素簇，超出截断（从宽处理，为空不算失败） */
export const IMAGE_ALT_MAX_GRAPHEMES = 40;

export function clampAlt(alt: string): string {
  const t = alt.replace(/\s+/g, ' ').trim();
  const seg = new Intl.Segmenter('zh', { granularity: 'grapheme' });
  const parts = [...seg.segment(t)].map((x) => x.segment);
  return parts.length > IMAGE_ALT_MAX_GRAPHEMES ? parts.slice(0, IMAGE_ALT_MAX_GRAPHEMES).join('') : t;
}

/** 带图且 status 为 ok 时，image_en 的最短长度 */
export const IMAGE_EN_MIN_CHARS = 10;

/** 解析与校验模型输出的 content 字符串；expectImage：本次提问带图（15 §8.3） */
export function parseLlmContent(
  content: string | null | undefined,
  opts: { expectImage?: boolean } = {},
): ParseResult {
  if (!content?.trim()) return { ok: false, reason: 'empty', detail: 'empty content' };
  let json: unknown;
  try {
    json = JSON.parse(stripCodeFence(content));
  } catch {
    return { ok: false, reason: 'json', detail: 'invalid JSON' };
  }
  const r = LlmOutputSchema.safeParse(json);
  if (!r.success) {
    const detail = r.error.issues
      .slice(0, 6)
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('；');
    return { ok: false, reason: 'schema', detail };
  }
  const v = r.data;
  if (v.status !== 'ok') return { ok: true, value: { status: v.status, message: v.message } };
  if (opts.expectImage && v.image_en.length < IMAGE_EN_MIN_CHARS) {
    return { ok: false, reason: 'schema', detail: 'image_en: required when the question has an image' };
  }
  const options = (v.options as z.infer<typeof OptionSchema>[]).map((o) => ({
    title: cleanTitle(o.title),
    desc: cleanDesc(o.desc),
    briefEn: o.brief_en.trim().replace(/\s+/g, ' '),
  }));
  if (!opts.expectImage) return { ok: true, value: { status: 'ok', questionEn: v.question_en, options } };
  return {
    ok: true,
    value: {
      status: 'ok',
      questionEn: v.question_en,
      options,
      imageEn: v.image_en.replace(/\s+/g, ' '),
      imageAlt: clampAlt(v.image_alt),
    },
  };
}

function stripCodeFence(s: string): string {
  const m = s.trim().match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return m ? m[1]! : s;
}
