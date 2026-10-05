import { UpstreamError } from '../http/errors';
import { log } from '../log';
import { chatCompletion } from './client';
import {
  buildMessages,
  buildRepairMessages,
  type ChatMessage,
  PROMPT_VERSION,
  type PromptImage,
  VISION_PROMPT_VERSION,
} from './prompt';
import { type LlmOption, parseLlmContent } from './schema';

// 选项生成：HTTP 重试 + 语义重试 + 修复提示，共享 deadline（02 §11、05 §5.2）

export const MAX_SEMANTIC_ATTEMPTS = 3;

export interface GenerateOptionsInput {
  question: string;
  previousTitles?: string[];
  /** 带图提问（15 §8.1） */
  image?: PromptImage;
  deadline: number;
  signal?: AbortSignal;
}

export interface LlmMeta {
  model: string;
  promptVersion: string;
  attempts: number; // HTTP 尝试总数
  semanticAttempts: number;
  repaired: boolean;
  latencyMs: number;
  usage?: { promptTokens: number; completionTokens: number; cacheHitTokens?: number };
}

export type GenerateOptionsResult =
  | {
      status: 'ok';
      questionEn: string;
      options: LlmOption[];
      imageEn?: string;
      imageAlt?: string;
      meta: LlmMeta;
    }
  | { status: 'unclear' | 'sensitive' | 'refused'; message: string; meta: LlmMeta };

export async function generateOptions(input: GenerateOptionsInput): Promise<GenerateOptionsResult> {
  const started = Date.now();
  const base = buildMessages(input.question, input.previousTitles, input.image);
  const expectImage = !!input.image;
  // 带图答案记为 options-v1+vision-vN（15 §8.2）
  const promptVersion = expectImage ? `${PROMPT_VERSION}+${VISION_PROMPT_VERSION}` : PROMPT_VERSION;
  let messages: ChatMessage[] = base;
  let httpAttempts = 0;
  let repaired = false;
  let lastModel = '';
  let usage: LlmMeta['usage'];

  for (let attempt = 1; attempt <= MAX_SEMANTIC_ATTEMPTS; attempt++) {
    const res = await chatCompletion(messages, { deadline: input.deadline, signal: input.signal }).catch(
      (e) => {
        if (e instanceof UpstreamError) e.attempts += httpAttempts;
        throw e;
      },
    );
    httpAttempts += res.attempts;
    lastModel = res.model;
    if (res.usage) {
      usage = {
        promptTokens: (usage?.promptTokens ?? 0) + res.usage.promptTokens,
        completionTokens: (usage?.completionTokens ?? 0) + res.usage.completionTokens,
        cacheHitTokens: (usage?.cacheHitTokens ?? 0) + (res.usage.cacheHitTokens ?? 0),
      };
    }
    const meta = (): LlmMeta => ({
      model: lastModel,
      promptVersion,
      attempts: httpAttempts,
      semanticAttempts: attempt,
      repaired,
      latencyMs: Date.now() - started,
      usage,
    });

    let reason: string;
    let nextRepair: { raw: string; detail: string } | undefined;
    if (res.malformed) {
      reason = 'malformed';
    } else if (res.finishReason === 'length') {
      reason = 'length';
    } else {
      const parsed = parseLlmContent(res.content, { expectImage });
      if (parsed.ok) {
        const v = parsed.value;
        if (v.status !== 'ok') return { status: v.status, message: v.message, meta: meta() };
        return {
          status: 'ok',
          questionEn: v.questionEn,
          options: v.options,
          ...(expectImage ? { imageEn: v.imageEn ?? '', imageAlt: v.imageAlt ?? '' } : {}),
          meta: meta(),
        };
      }
      reason = parsed.reason;
      if (parsed.reason === 'schema' && res.content) nextRepair = { raw: res.content, detail: parsed.detail };
    }

    log().warn({ evt: 'llm.bad_output', attempt, reason });
    // 第 2 次尝试：schema 不通过时用修复提示；其余情况与第 3 次尝试都重新采样
    if (attempt === 1 && nextRepair) {
      messages = buildRepairMessages(base, nextRepair.raw, nextRepair.detail);
      repaired = true;
    } else {
      messages = base;
    }
    if (input.deadline - Date.now() <= 1000) break;
  }

  throw new UpstreamError({ source: 'llm', kind: 'BAD_OUTPUT', retryable: true, attempts: httpAttempts });
}
