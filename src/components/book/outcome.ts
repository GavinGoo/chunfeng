// 结果 → 答案组件的数据模型、播报文案

import { formatErrorExtra, zh } from '@/copy/zh';
import type { ClientError } from '@/lib/client/createReading';
import type { PageContentModel } from './deps';
import type { Outcome } from './machine';

export function toPageModel(o: Outcome): PageContentModel {
  switch (o.kind) {
    case 'ok':
      return { kind: 'answer', reading: o.reading, owner: o.owner };
    case 'notice':
      return {
        kind: 'notice',
        status: o.status,
        message: o.message,
        resources: o.resources,
        question: o.question,
        hasImage: o.hasImage,
      };
    case 'error':
      return { kind: 'error', error: o.error, question: o.question, hasImage: o.hasImage };
    case 'notFound':
      return { kind: 'notFound' };
  }
}

/** 错误的播报文案：标题 + 补充句 */
export function errorTitle(e: ClientError): string {
  if (e.code === 'OFFLINE') return zh.error.offline.title;
  if (e.code === 'SERVICE_MISCONFIGURED') return zh.error.misconfigured.title;
  const extra =
    e.code === 'NETWORK' || e.code === 'TIMEOUT' || e.code === 'ABORTED'
      ? zh.error.network
      : formatErrorExtra(e.code, e.retryAfterMs);
  return [zh.error.retryable.title, zh.error.retryable.body, extra].filter(Boolean).join('');
}
