import { getConfig } from '../config';
import { UpstreamError } from '../http/errors';
import { defaultPolicy, fetchWithRetry } from '../http/fetchWithRetry';
import { log } from '../log';
import { upstreamFetch } from '../upstreams';
import { redactJevRequest } from './buildRequest';
import { type JevRequest, type JevResponse, JevResponseSchema } from './types';

// JEV 调用（03 §6.1）：经 fetchWithRetry，最多 4 次尝试；兼容网关与官方的错误体。

export interface JevCallResult {
  response: JevResponse;
  attempts: number;
  upstreamRequestId?: string;
}

export async function callJev(
  req: JevRequest,
  ctx: { deadline: number; signal?: AbortSignal },
): Promise<JevCallResult> {
  const cfg = getConfig();
  try {
    const res = await fetchWithRetry(
      cfg.jev.url,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${cfg.jev.key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(req),
      },
      defaultPolicy({ maxAttempts: 4, perAttemptTimeoutMs: cfg.jev.timeoutMs }),
      { deadline: ctx.deadline, source: 'jev', signal: ctx.signal, fetchImpl: upstreamFetch('jev') },
    );
    let json: unknown;
    try {
      json = JSON.parse(res.text);
    } catch {
      throw new UpstreamError({ source: 'jev', kind: 'BAD_OUTPUT', retryable: true, attempts: res.attempts });
    }
    const parsed = JevResponseSchema.safeParse(json);
    if (!parsed.success) {
      throw new UpstreamError({ source: 'jev', kind: 'BAD_OUTPUT', retryable: true, attempts: res.attempts });
    }
    return { response: parsed.data, attempts: res.attempts, upstreamRequestId: res.upstreamRequestId };
  } catch (e) {
    if (e instanceof UpstreamError && e.status === 422) {
      log().error({ evt: 'jev.request_rejected', request: redactJevRequest(req) }, 'JEV 拒绝了请求体');
    }
    throw e;
  }
}
