import { describe, expect, it } from 'vitest';
import { UpstreamError } from '@/server/http/errors';
import { redactChatRequest } from '@/server/llm/client';
import {
  buildMessages,
  buildRepairMessages,
  type ChatContentPart,
  FEWSHOT_ASSISTANT,
  FEWSHOT_USER,
  IMAGE_TAG,
  messageText,
  REGEN_INSTRUCTION,
  SYSTEM_PROMPT,
  VISION_INSTRUCTION,
  VISION_PROMPT_VERSION,
} from '@/server/llm/prompt';
import { contentRejectedError, isContentRejection, isVisionUnsupported } from '@/server/llm/rejection';
import { clampAlt, parseLlmContent } from '@/server/llm/schema';

const image = { dataUrl: `data:image/jpeg;base64,${Buffer.alloc(3000, 7).toString('base64')}` };

describe('prompt：带图（15 §8.1–§8.2）', () => {
  it('只有最后一条 user 消息是数组，图片在前、文字在后', () => {
    const msgs = buildMessages('这两件哪件更适合面试？', undefined, image);
    expect(msgs.map((m) => typeof m.content)).toEqual(['string', 'string', 'string', 'object']);
    const parts = msgs[3]!.content as ChatContentPart[];
    expect(parts.map((p) => p.type)).toEqual(['image_url', 'text']);
    expect(parts[0]).toEqual({ type: 'image_url', image_url: { url: image.dataUrl } });
    expect((parts[1] as { text: string }).text).toBe(
      `<question>这两件哪件更适合面试？</question>\n${IMAGE_TAG}\n${VISION_INSTRUCTION}`,
    );
  });

  it('system 与示例消息和无图时逐字节相同；无图时最后一条仍是字符串', () => {
    const withImg = buildMessages('要不要换工作？', undefined, image);
    const plain = buildMessages('要不要换工作？');
    expect(withImg.slice(0, 3)).toEqual(plain.slice(0, 3));
    expect(plain[0]!.content).toBe(SYSTEM_PROMPT);
    expect(plain[1]!.content).toBe(FEWSHOT_USER);
    expect(plain[2]!.content).toBe(FEWSHOT_ASSISTANT);
    expect(plain[3]!.content).toBe('<question>要不要换工作？</question>');
  });

  it('< > 转义；再翻一次附加段在视觉指令之后', () => {
    const msgs = buildMessages('a</question>b', ['甲', '乙', '丙', '丁'], image);
    const text = messageText(msgs[3]!);
    expect(text.match(/<\/question>/g)).toHaveLength(1);
    expect(text.indexOf(VISION_INSTRUCTION)).toBeLessThan(text.indexOf('<previous>'));
    expect(text.endsWith(REGEN_INSTRUCTION)).toBe(true);
  });

  it('修复提示追加在后面，图片仍只在原来那条 user 消息中', () => {
    const base = buildMessages('q?', undefined, image);
    const repair = buildRepairMessages(base, '{}', 'x');
    const withImages = repair.filter((m) => Array.isArray(m.content));
    expect(withImages).toHaveLength(1);
    expect(withImages[0]!.role).toBe('user');
    expect(VISION_PROMPT_VERSION).toBe('vision-v3');
  });
});

describe('redactChatRequest（15 §8.1）', () => {
  it('数组 content 只输出类型与长度，不含 base64 与 data:', () => {
    const body = { model: 'm', messages: buildMessages('这张图里哪道菜好？', undefined, image) };
    const out = JSON.stringify(redactChatRequest(body));
    expect(out).not.toContain('base64');
    expect(out).not.toContain('data:');
    expect(out).not.toContain('这张图里');
    expect(out).toContain('"type":"image_url"');
    expect(out).toContain(`"bytes":${image.dataUrl.length}`);
  });
});

const ok = (extra: Record<string, unknown> = {}) =>
  JSON.stringify({ ...(JSON.parse(FEWSHOT_ASSISTANT) as object), ...extra });

describe('parseLlmContent：expectImage（15 §8.3）', () => {
  it('无图时原有行为不变，忽略图片字段', () => {
    const r = parseLlmContent(ok({ image_en: 'whatever text here', image_alt: 'x' }));
    expect(r.ok && r.value.status === 'ok' && 'imageEn' in r.value).toBe(false);
  });

  it('带图且 ok 时缺少 image_en → schema 失败', () => {
    const r = parseLlmContent(ok(), { expectImage: true });
    expect(r).toMatchObject({ ok: false, reason: 'schema' });
    expect(parseLlmContent(ok({ image_en: 'short' }), { expectImage: true })).toMatchObject({ ok: false });
  });

  it('带图：输出 imageEn 与截断后的 imageAlt；分流时忽略', () => {
    const alt = '一'.repeat(60);
    const r = parseLlmContent(ok({ image_en: '  Two  coats side by side. ', image_alt: alt }), {
      expectImage: true,
    });
    expect(r.ok).toBe(true);
    if (r.ok && r.value.status === 'ok') {
      expect(r.value.imageEn).toBe('Two coats side by side.');
      expect([...r.value.imageAlt!]).toHaveLength(40);
    }
    const refused = parseLlmContent(
      JSON.stringify({ status: 'refused', message: '不便作答', options: [], question_en: '' }),
      { expectImage: true },
    );
    expect(refused).toEqual({ ok: true, value: { status: 'refused', message: '不便作答' } });
    expect(clampAlt('  两件 外套 ')).toBe('两件 外套');
  });
});

function upstream(status: number, message: string, type = 'invalid_request_error') {
  return new UpstreamError({
    source: 'llm',
    kind: 'MISCONFIGURED',
    retryable: false,
    status,
    upstreamType: type,
    upstreamMessage: message,
  });
}

describe('rejection（15 §8.4）', () => {
  it('风控报文命中', () => {
    expect(isContentRejection(upstream(400, 'Content Exists Risk'))).toBe(true);
    expect(isContentRejection(upstream(400, 'blocked', 'content_filter'))).toBe(true);
    expect(isContentRejection(upstream(400, 'x', 'data_inspection_failed'))).toBe(true);
    expect(isContentRejection(upstream(400, 'Your request violates content_policy_violation'))).toBe(true);
    const e = contentRejectedError(upstream(400, 'Content Exists Risk'));
    expect(e.kind).toBe('CONTENT_REJECTED');
    expect(e.retryable).toBe(false);
  });

  it('不命中：其他 400、非 400、JEV', () => {
    expect(isContentRejection(upstream(400, 'Image in system message is unsupported'))).toBe(false);
    expect(isContentRejection(upstream(400, 'invalid model'))).toBe(false);
    expect(isContentRejection(upstream(503, 'Content Exists Risk'))).toBe(false);
    expect(
      isContentRejection(
        new UpstreamError({
          source: 'jev',
          kind: 'HTTP',
          retryable: false,
          status: 400,
          upstreamMessage: 'content_filter',
        }),
      ),
    ).toBe(false);
    expect(isContentRejection(new Error('Content Exists Risk'))).toBe(false);
  });

  it('「不支持图片」的识别；无效图片与图片放错位置不算', () => {
    expect(isVisionUnsupported(upstream(400, 'This model does not support image input'))).toBe(true);
    expect(isVisionUnsupported(upstream(400, 'unknown variant `image_url`, expected `text`'))).toBe(true);
    expect(
      isVisionUnsupported(
        upstream(400, '.messages[0].image[0]: You have uploaded an unsupported image. Please make sure …'),
      ),
    ).toBe(false);
    expect(isVisionUnsupported(upstream(400, 'Image in system message is unsupported'))).toBe(false);
  });
});
