import { getConfig } from '../config';
import { UpstreamError } from '../http/errors';
import { defaultPolicy, fetchWithRetry } from '../http/fetchWithRetry';
import { log } from '../log';
import { upstreamFetch } from '../upstreams';
import type { ChatMessage } from './prompt';
import { contentRejectedError, isContentRejection, isVisionUnsupported } from './rejection';

// OpenAI 兼容 chat/completions 调用（02 §3）。LLM_API_URL 是完整 endpoint。

export interface ChatResult {
  content: string | null;
  finishReason?: string;
  model: string;
  usage?: { promptTokens: number; completionTokens: number; cacheHitTokens?: number };
  attempts: number;
  malformed: boolean; // HTTP 200 但响应体不是合法的 completion
}

interface CompletionBody {
  model?: string;
  choices?: { finish_reason?: string; message?: { content?: string | null } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_cache_hit_tokens?: number };
}

export async function chatCompletion(
  messages: ChatMessage[],
  ctx: { deadline: number; signal?: AbortSignal },
): Promise<ChatResult> {
  const cfg = getConfig();
  const body: Record<string, unknown> = {
    model: cfg.llm.model,
    messages,
    response_format: { type: 'json_object' },
    thinking: { type: cfg.llm.thinking },
    temperature: cfg.llm.temperature,
    max_tokens: cfg.llm.maxTokens,
    stream: false,
  };
  const res = await fetchWithRetry(
    cfg.llm.url,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${cfg.llm.key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
    defaultPolicy({ maxAttempts: 3, perAttemptTimeoutMs: cfg.llm.timeoutMs }),
    { deadline: ctx.deadline, source: 'llm', signal: ctx.signal, fetchImpl: upstreamFetch('llm') },
  ).catch((e: unknown) => {
    // 内容风控拦截：不是配置错误，编排层转为 refused（15 §8.4）
    if (isContentRejection(e)) {
      log().warn({ evt: 'llm.content_rejected', status: (e as UpstreamError).status });
      throw contentRejectedError(e as UpstreamError);
    }
    if (isVisionUnsupported(e)) {
      log().fatal(
        { evt: 'llm.vision_unsupported', model: cfg.llm.model },
        '当前 LLM_MODEL 不接受图片输入，请检查 LLM_VISION 与 LLM_MODEL',
      );
    }
    // 400/422 属于请求构造缺陷：附脱敏请求体（只含结构与长度，不含提问原文与图片）
    if (e instanceof UpstreamError && (e.status === 400 || e.status === 422)) {
      log().error({ evt: 'llm.request_rejected', request: redactChatRequest(body) }, 'LLM 拒绝了请求体');
    }
    throw e;
  });

  let parsed: CompletionBody;
  try {
    // DeepSeek 排队期间会输出空行保活，JSON.parse 可容忍前导空白
    parsed = JSON.parse(res.text) as CompletionBody;
  } catch {
    return { content: null, model: cfg.llm.model, attempts: res.attempts, malformed: true };
  }
  const choice = parsed.choices?.[0];
  // HTTP 200 但内容被风控省略（DeepSeek 文档：finish_reason = content_filter）
  if (choice?.finish_reason === 'content_filter') {
    log().warn({ evt: 'llm.content_rejected', finishReason: 'content_filter' });
    throw new UpstreamError({
      source: 'llm',
      kind: 'CONTENT_REJECTED',
      retryable: false,
      attempts: res.attempts,
    });
  }
  return {
    content: choice?.message?.content ?? null,
    finishReason: choice?.finish_reason,
    model: parsed.model ?? cfg.llm.model,
    usage: parsed.usage
      ? {
          promptTokens: parsed.usage.prompt_tokens ?? 0,
          completionTokens: parsed.usage.completion_tokens ?? 0,
          cacheHitTokens: parsed.usage.prompt_cache_hit_tokens,
        }
      : undefined,
    attempts: res.attempts,
    malformed: !choice,
  };
}

/** 日志用：脱敏后的请求体。数组 content 只输出每个部件的类型与长度，绝不含 base64（15 §8.1） */
export function redactChatRequest(body: Record<string, unknown>): Record<string, unknown> {
  const messages = Array.isArray(body.messages) ? (body.messages as ChatMessage[]) : [];
  return {
    ...body,
    messages: messages.map((m) =>
      typeof m.content === 'string'
        ? { role: m.role, chars: m.content.length }
        : {
            role: m.role,
            parts: m.content.map((p) =>
              p.type === 'text'
                ? { type: p.type, chars: p.text.length }
                : { type: p.type, bytes: p.image_url.url.length },
            ),
          },
    ),
  };
}
