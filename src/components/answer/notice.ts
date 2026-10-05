// 提示页与错误页的内容描述（11 §7）：纯函数，把模型映射为标题、正文与页上的操作。

import { formatErrorExtra, zh } from '@/copy/zh';
import type { ClientError } from '@/lib/client/createReading';
import type { ErrorCode, HelpResource } from '@/lib/shared/types';

export type PageAction = 'retry' | 'reask' | 'newQuestion' | 'askToo';

export type NoticeInput =
  | {
      kind: 'notice';
      status: 'unclear' | 'sensitive' | 'refused';
      message: string;
      resources?: HelpResource[];
    }
  | { kind: 'error'; error: ClientError }
  | { kind: 'notFound' };

export interface NoticeAction {
  action: PageAction;
  label: string;
  primary: boolean;
}

export interface NoticeDescription {
  /** 用于样式与测试的变体名 */
  variant:
    | 'unclear'
    | 'sensitive'
    | 'refused'
    | 'retryable'
    | 'fatal'
    | 'misconfigured'
    | 'offline'
    | 'notFound';
  title: string;
  body: string;
  /** 按错误码补充的一句（RATE_LIMITED 的秒数由组件实时填写） */
  extra?: string;
  resources?: HelpResource[];
  actions: NoticeAction[];
  /** 是否需要倒计时（「再试一次」在 retryAvailableAt 之前置灰） */
  countdown: boolean;
}

const RETRY: NoticeAction = { action: 'retry', label: zh.actions.retry, primary: true };
const NEW_QUESTION_LINK: NoticeAction = {
  action: 'newQuestion',
  label: zh.actions.changeQuestion,
  primary: false,
};
const NEW_QUESTION_MAIN: NoticeAction = {
  action: 'newQuestion',
  label: zh.actions.changeQuestion,
  primary: true,
};

/** 前端网络层错误码对应的补充句 */
function errorExtra(code: ClientError['code'], retryAfterMs?: number): string | undefined {
  if (code === 'NETWORK') return zh.error.network;
  if (code === 'TIMEOUT') return zh.error.extra.UPSTREAM_TIMEOUT;
  if (code === 'OFFLINE' || code === 'ABORTED') return undefined;
  return formatErrorExtra(code as ErrorCode, retryAfterMs);
}

export function describeNotice(model: NoticeInput): NoticeDescription {
  if (model.kind === 'notFound') {
    return {
      variant: 'notFound',
      title: zh.notFound.title,
      body: zh.notFound.body,
      actions: [{ action: 'askToo', label: zh.actions.ask, primary: true }],
      countdown: false,
    };
  }

  if (model.kind === 'notice') {
    // 危机分流时后端的 message 为空：回退到静态文案
    const message = model.message.trim();
    switch (model.status) {
      case 'unclear':
        return {
          variant: 'unclear',
          title: zh.notice.unclear.title,
          body: message || zh.notice.unclear.fallback,
          actions: [{ action: 'reask', label: zh.actions.askAgain, primary: true }],
          countdown: false,
        };
      case 'sensitive':
        return {
          variant: 'sensitive',
          title: zh.notice.sensitive.title,
          body: message || zh.notice.sensitive.fallback,
          resources: model.resources ?? [],
          actions: [NEW_QUESTION_MAIN],
          countdown: false,
        };
      case 'refused':
        return {
          variant: 'refused',
          title: zh.notice.refused.title,
          body: message || zh.notice.refused.fallback,
          actions: [NEW_QUESTION_MAIN],
          countdown: false,
        };
    }
  }

  const { error } = model;
  if (error.code === 'OFFLINE') {
    return {
      variant: 'offline',
      title: zh.error.offline.title,
      body: zh.error.offline.body,
      actions: [RETRY],
      countdown: false,
    };
  }
  if (error.code === 'SERVICE_MISCONFIGURED') {
    return {
      variant: 'misconfigured',
      title: zh.error.misconfigured.title,
      body: zh.error.misconfigured.body,
      actions: [NEW_QUESTION_MAIN],
      countdown: false,
    };
  }
  if (error.code === 'NOT_FOUND') return describeNotice({ kind: 'notFound' });

  const extra = errorExtra(error.code, error.retryAfterMs);
  if (!error.retryable) {
    return {
      variant: 'fatal',
      title: zh.error.retryable.title,
      body: zh.error.retryable.body,
      extra,
      actions: [NEW_QUESTION_MAIN],
      countdown: false,
    };
  }
  return {
    variant: 'retryable',
    title: zh.error.retryable.title,
    body: zh.error.retryable.body,
    extra,
    actions: [RETRY, NEW_QUESTION_LINK],
    countdown: error.code === 'RATE_LIMITED' || (error.retryAfterMs ?? 0) > 0,
  };
}
