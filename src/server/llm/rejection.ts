import { UpstreamError } from '../http/errors';

// LLM 的内容风控与「不支持图片」识别（15 §8.4）。
// 特征表必须精确：没有命中的 400 仍按 SERVICE_MISCONFIGURED 处理（05 §3.1）。
// 2026-09-29 核实：DeepSeek 文档的错误码表没有风控专用的错误；chat completion 文档列出
// finish_reason = "content_filter"（HTTP 200，内容被风控省略）。400 的 "Content Exists Risk" 为社区报告的历史报文，
// 其余为兼容网关与其他 OpenAI 兼容服务的常见写法。以线上样本为准增删。

export const CONTENT_REJECTION_PATTERNS: readonly string[] = [
  'content exists risk',
  'content_filter',
  'content_policy_violation',
  'data_inspection_failed',
];

// 实测样本（2026-09-29，deepseek-flash）：
//   图片放进 system 消息 → 400 "Image in system message is unsupported"（请求构造缺陷，不属于此类）
//   图片字节无效 → 400 "You have uploaded an unsupported image. Please make sure your image is valid …"（同上）
// 以下特征表示「模型本身不接受图片输入」，只匹配模型层面的表述。
export const VISION_UNSUPPORTED_PATTERNS: readonly string[] = [
  'does not support image',
  'image input is not supported',
  'image_url is not supported',
  'unknown variant `image_url`',
  'unsupported content type: image_url',
  'model does not support vision',
];

function haystack(e: UpstreamError): string {
  return `${e.upstreamType ?? ''}\n${e.upstreamMessage ?? ''}`.toLowerCase();
}

export function isContentRejection(e: unknown): boolean {
  if (!(e instanceof UpstreamError) || e.source !== 'llm') return false;
  if (e.status !== 400 && e.status !== 422 && e.status !== 403) return false;
  const h = haystack(e);
  return CONTENT_REJECTION_PATTERNS.some((p) => h.includes(p));
}

export function isVisionUnsupported(e: unknown): boolean {
  if (!(e instanceof UpstreamError) || e.source !== 'llm') return false;
  if (e.status !== 400 && e.status !== 422) return false;
  const h = haystack(e);
  return VISION_UNSUPPORTED_PATTERNS.some((p) => h.includes(p));
}

export function contentRejectedError(from?: UpstreamError): UpstreamError {
  return new UpstreamError({
    source: 'llm',
    kind: 'CONTENT_REJECTED',
    retryable: false,
    status: from?.status,
    attempts: from?.attempts,
    upstreamRequestId: from?.upstreamRequestId,
    upstreamType: from?.upstreamType,
  });
}
