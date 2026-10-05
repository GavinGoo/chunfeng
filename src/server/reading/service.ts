import { customAlphabet } from 'nanoid';
import { pageNoFromId } from '@/lib/shared/ids';
import type { CreateReadingResponse, NoticeStatus } from '@/lib/shared/types';
import { getConfig } from '../config';
import { AppError, UpstreamError } from '../http/errors';
import { readImage } from '../image/store';
import { isVisionEnabled } from '../image/vision';
import { scoreOptions } from '../jev/scoring';
import { type GenerateOptionsResult, generateOptions } from '../llm/generateOptions';
import { PROMPT_VERSION, VISION_PROMPT_VERSION } from '../llm/prompt';
import { log } from '../log';
import { checkCrisis } from '../safety/crisis';
import { helpResources } from '../safety/resources';
import { requestFingerprint } from './idempotency';
import { rankOptions } from './rank';
import { getRepository } from './repository';
import { regenSimilarity } from './similarity';
import { serverState } from './state';

// 编排（04 §2.3）：幂等 → 限流 → 并发闸门 → 危机词预检 → LLM → JEV → 融合排序 → 落库。
// 所有上游调用共享同一个 deadline；错误一律以 AppError / UpstreamError 抛出，由路由层映射为 ApiErrorBody。

/** 公开 ID：nanoid 12 位，字母数字（约 71 bit），是 READING_ID_RE 的子集 */
export const newReadingId = customAlphabet(
  '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz',
  12,
);

export interface CreateReadingInput {
  question: string; // 已规范化并通过长度校验
  requestId: string;
  tz: string; // 已校验（非法时已回退 Asia/Shanghai）
  regenOf?: string;
  imageId?: string; // 格式已校验；存在性在这里检查（15 §7.2 第 1a 步）
  ipHash: string;
  startedAt?: number;
}

/** 编排内部使用：已确定的图片 */
interface ResolvedInput extends CreateReadingInput {
  effectiveImageId?: string;
  fingerprint: string;
}

function notice(status: NoticeStatus, message: string): CreateReadingResponse {
  return status === 'sensitive' ? { status, message, resources: helpResources() } : { status, message };
}

/**
 * 处理一次创建请求。调用方（路由）已完成请求体校验与 Origin 校验。
 * 注意：从幂等检查到登记 inflight 之间不能有 await，保证并发的同一 requestId 只执行一次。
 */
export function createReading(input: CreateReadingInput): Promise<CreateReadingResponse> {
  const startedAt = input.startedAt ?? Date.now();
  const cfg = getConfig();
  const { idempotency, rateLimiter } = serverState();
  const repo = getRepository();

  // 1a. 确定这次提问的图片（同步查询，不破坏下方「不能有 await」的约束）
  let effectiveImageId: string | undefined;
  try {
    effectiveImageId = resolveImage(input);
  } catch (e) {
    return Promise.reject(e);
  }
  const fingerprint = requestFingerprint(input.question, effectiveImageId);

  // 3a. DB 中已有 → 直接返回（不计入限流）
  const existing = repo.getByRequestId(input.requestId);
  if (existing) {
    if (requestFingerprint(existing.question, existing.imageId) !== fingerprint) {
      return Promise.reject(new AppError('BAD_REQUEST', 'requestId already used for a different question'));
    }
    log().info({ evt: 'reading.replay', requestId: input.requestId, source: 'db' });
    return Promise.resolve({ status: 'ok', reading: existing.reading });
  }
  // 3b/3c. inflight 合并；指纹不同 → 400
  try {
    const joined = idempotency.join(input.requestId, fingerprint);
    if (joined) {
      log().info({ evt: 'reading.replay', requestId: input.requestId, source: 'inflight' });
      return joined;
    }
    idempotency.getPartial(input.requestId, fingerprint); // 仅用于一致性校验
  } catch (e) {
    return Promise.reject(e);
  }

  // 4. 限流
  const decision = rateLimiter.take(input.ipHash);
  if (!decision.ok) {
    log().warn({ evt: 'ratelimit.hit', ipHash: input.ipHash, scope: decision.scope });
    return Promise.reject(
      new AppError('RATE_LIMITED', `rate limited (${decision.scope})`, {
        retryAfterMs: decision.retryAfterMs,
      }),
    );
  }

  // 6. deadline 从请求到达时起算，保证总耗时不超过 READING_DEADLINE_MS（05 §8）
  const deadline = startedAt + cfg.readingDeadlineMs;
  const resolved: ResolvedInput = { ...input, effectiveImageId, fingerprint };
  return idempotency.run(input.requestId, fingerprint, () => orchestrate(resolved, startedAt, deadline));
}

/**
 * 15 §7.2 第 1a 步：请求带 imageId → 校验其存在；否则若为「再翻一次」且上一条带图 → 沿用上一条的图。
 * 有图但图片功能已关闭 → VISION_DISABLED（问题指向一张图，不能去掉图片硬答）。
 */
function resolveImage(input: CreateReadingInput): string | undefined {
  const repo = getRepository();
  let id: string | undefined;
  if (input.imageId) {
    if (!isVisionEnabled()) throw new AppError('VISION_DISABLED', 'image questions are disabled');
    if (!repo.imageExists(input.imageId)) throw new AppError('IMAGE_NOT_FOUND', 'image not found');
    id = input.imageId;
  } else if (input.regenOf) {
    id = repo.getReadingImageId(input.regenOf) ?? undefined;
    if (id && !isVisionEnabled()) throw new AppError('VISION_DISABLED', 'image questions are disabled');
  }
  return id;
}

/** 读取 full 规格的图片，转为 data URL；文件缺失 → IMAGE_NOT_FOUND */
async function loadImageDataUrl(imageId: string): Promise<{ dataUrl: string }> {
  const buf = await readImage(imageId, 'full');
  if (!buf) throw new AppError('IMAGE_NOT_FOUND', 'image file missing');
  return { dataUrl: `data:image/jpeg;base64,${buf.toString('base64')}` };
}

function isContentRejected(e: unknown): e is UpstreamError {
  return e instanceof UpstreamError && e.kind === 'CONTENT_REJECTED';
}

async function orchestrate(
  input: ResolvedInput,
  startedAt: number,
  deadline: number,
): Promise<CreateReadingResponse> {
  const cfg = getConfig();
  const { idempotency, semaphore } = serverState();
  const repo = getRepository();

  // 5. 并发闸门（排队最多 10 s，且不超过剩余预算）
  const release = await semaphore.acquire(Math.min(10_000, Math.max(0, deadline - Date.now() - 1000)));
  try {
    // 7. 危机词预检
    const crisis = checkCrisis(input.question);
    if (crisis.hit) {
      log().info({
        evt: 'reading.outcome',
        requestId: input.requestId,
        status: 'sensitive',
        source: 'keyword',
      });
      // message 为空：前端使用 copy/zh.ts 中的静态关怀文案（11 §7）
      return notice('sensitive', '');
    }

    // 8. 再翻一次：上一条的 4 个标题（不存在则忽略 regenOf）
    const previousTitles = input.regenOf ? (repo.getTitles(input.regenOf) ?? undefined) : undefined;
    const regenOf = previousTitles ? input.regenOf : undefined;

    // 9. LLM（复用 partialCache）；有图时读取 full 文件 → base64 data URL
    const hasImage = !!input.effectiveImageId;
    const llmStarted = Date.now();
    let llm: GenerateOptionsResult | undefined = idempotency.getPartial(input.requestId, input.fingerprint);
    const llmCached = !!llm;
    let filtered = false;
    if (!llm) {
      const image = input.effectiveImageId ? await loadImageDataUrl(input.effectiveImageId) : undefined;
      try {
        llm = await generateOptions({ question: input.question, previousTitles, image, deadline });
      } catch (e) {
        // 9a. 内容风控拦截 → refused（前端回退到静态文案），不落库（15 §8.4）
        if (!isContentRejected(e)) throw e;
        filtered = true;
        llm = {
          status: 'refused',
          message: '',
          meta: {
            model: getConfig().llm.model,
            promptVersion: hasImage ? `${PROMPT_VERSION}+${VISION_PROMPT_VERSION}` : PROMPT_VERSION,
            attempts: e.attempts,
            semanticAttempts: 1,
            repaired: false,
            latencyMs: Date.now() - llmStarted,
          },
        };
      }
      idempotency.setPartial(input.requestId, input.fingerprint, llm);
    }
    const llmMs = llmCached ? 0 : Date.now() - llmStarted;

    // 10. 分流结果不落库、不调用 JEV
    if (llm.status !== 'ok') {
      const fields = {
        evt: 'reading.outcome',
        requestId: input.requestId,
        status: llm.status,
        source: filtered ? 'llm_filter' : 'llm',
        hasImage,
      };
      if (filtered) log().warn(fields);
      else log().info(fields);
      return notice(llm.status, llm.message);
    }

    // 11. JEV
    const jevStarted = Date.now();
    const briefsEn = llm.options.map((o) => o.briefEn) as [string, string, string, string];
    const jev = await scoreOptions({
      question: input.question,
      questionEn: llm.questionEn,
      briefsEn,
      imageEn: hasImage ? llm.imageEn : undefined,
      deadline,
    });
    const jevMs = Date.now() - jevStarted;

    // 12. 排序、字母、百分比
    const { options, order } = rankOptions({ options: llm.options, probs: jev.probs, fit: jev.fit });

    // 13–14. 落库
    const id = newReadingId();
    const saved = repo.insert({
      id,
      requestId: input.requestId,
      question: input.question,
      options,
      llm: {
        model: llm.meta.model,
        promptVersion: llm.meta.promptVersion,
        questionEn: llm.questionEn,
        briefsEn,
        usage: llm.meta.usage,
        attempts: llm.meta.attempts,
        semanticAttempts: llm.meta.semanticAttempts,
        repaired: llm.meta.repaired,
        ...(hasImage
          ? { hasImage: true, imageEn: llm.imageEn ?? '', visionPromptVersion: VISION_PROMPT_VERSION }
          : {}),
      },
      scoring: {
        strategy: jev.meta.strategy,
        version: jev.meta.version,
        params: jev.meta.params,
        choice: jev.choice,
        fit: jev.fit,
        probs: jev.probs,
        order,
        confidence: jev.confidence,
        positionAgreement: jev.positionAgreement,
        raw: jev.raw,
      },
      jevModel: jev.meta.model,
      tz: input.tz,
      pageNo: pageNoFromId(id),
      regenOf,
      ipHash: input.ipHash,
      createdAt: Date.now(),
      imageId: input.effectiveImageId,
      imageAlt: hasImage ? (llm.imageAlt ?? '') : undefined,
    });

    // 15. 结构化日志（默认不含提问原文与选项文本）
    const similarity = previousTitles
      ? regenSimilarity(
          llm.options.map((o) => o.title),
          previousTitles,
        )
      : undefined;
    log().info({
      evt: 'reading.created',
      id: saved.reading.id,
      requestId: input.requestId,
      llmMs,
      jevMs,
      totalMs: Date.now() - startedAt,
      llmAttempts: llm.meta.attempts,
      llmCached,
      jevAttempts: jev.meta.attempts,
      llmUsage: llm.meta.usage,
      jevUsage: jev.meta.usage,
      strategy: jev.meta.strategy,
      confidence: jev.confidence,
      positionAgreement: jev.positionAgreement,
      regen: !!regenOf,
      // 不含图片内容，也不含 image_alt 原文（15 §7.2 第 15 步）
      hasImage,
      ...(hasImage ? { visionPromptVersion: VISION_PROMPT_VERSION } : {}),
      ...(similarity
        ? { regenSimilarCount: similarity.similarCount, regenMaxSimilarity: similarity.maxSimilarity }
        : {}),
      ...(cfg.logContent ? { question: input.question, titles: options.map((o) => o.title) } : {}),
    });

    return { status: 'ok', reading: saved.reading };
  } catch (e) {
    logFailure(e, input.requestId, startedAt);
    throw e;
  } finally {
    release();
  }
}

function logFailure(e: unknown, requestId: string, startedAt: number): void {
  const totalMs = Date.now() - startedAt;
  if (e instanceof AppError) {
    log().warn({ evt: 'reading.failed', requestId, code: e.code, totalMs });
  } else if (e instanceof UpstreamError) {
    log().warn({
      evt: 'reading.failed',
      requestId,
      source: e.source,
      kind: e.kind,
      status: e.status,
      attempts: e.attempts,
      upstreamRequestId: e.upstreamRequestId,
      totalMs,
    });
  } else {
    log().error({
      evt: 'reading.failed',
      requestId,
      code: 'INTERNAL',
      err: e instanceof Error ? { name: e.name, message: e.message, stack: e.stack } : String(e),
      totalMs,
    });
  }
}
