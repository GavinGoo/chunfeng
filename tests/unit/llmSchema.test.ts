import { describe, expect, it } from 'vitest';
import { FEWSHOT_ASSISTANT } from '@/server/llm/prompt';
import { cleanDesc, cleanTitle, parseLlmContent, titleKey } from '@/server/llm/schema';

const option = (title: string) => ({
  title,
  desc: '这是一段足够长的说明文字，用来通过最短长度的校验要求。',
  brief_en: 'An English brief of this option.',
});

const ok = (titles = ['甲路', '乙路', '丙路', '丁路']) =>
  JSON.stringify({ status: 'ok', message: '', question_en: 'Q?', options: titles.map(option) });

describe('parseLlmContent（02 §8）', () => {
  it('示例输出可以通过校验', () => {
    const r = parseLlmContent(FEWSHOT_ASSISTANT);
    expect(r.ok).toBe(true);
    if (r.ok && r.value.status === 'ok') {
      expect(r.value.options).toHaveLength(4);
      expect(r.value.options[0]!.briefEn).toMatch(/^Accept the startup offer/);
    }
  });

  it('空内容、非 JSON、Markdown 代码块', () => {
    expect(parseLlmContent('')).toMatchObject({ ok: false, reason: 'empty' });
    expect(parseLlmContent(null)).toMatchObject({ ok: false, reason: 'empty' });
    expect(parseLlmContent('{"status":')).toMatchObject({ ok: false, reason: 'json' });
    expect(parseLlmContent(`\`\`\`json\n${ok()}\n\`\`\``)).toMatchObject({ ok: true });
  });

  it('status=ok 时必须恰好 4 项且有 question_en', () => {
    const three = JSON.stringify({ status: 'ok', question_en: 'Q', options: ['a', 'b', 'c'].map(option) });
    expect(parseLlmContent(three)).toMatchObject({ ok: false, reason: 'schema' });
    const noEn = JSON.stringify({ status: 'ok', options: ['甲路', '乙路', '丙路', '丁路'].map(option) });
    const r = parseLlmContent(noEn);
    expect(r).toMatchObject({ ok: false, reason: 'schema' });
    if (!r.ok) expect(r.detail).toContain('question_en');
  });

  it('选项字段过短 → schema 错误，并给出路径', () => {
    const bad = JSON.stringify({
      status: 'ok',
      question_en: 'Q',
      options: [option('甲路'), option('乙路'), option('丙路'), { title: '丁', desc: '短', brief_en: 'x' }],
    });
    const r = parseLlmContent(bad);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.detail).toContain('options.3');
  });

  it('标题规范化后重复 → schema 错误', () => {
    const r = parseLlmContent(ok(['先谈加薪', '「先谈加薪」', '丙路', '丁路']));
    expect(r).toMatchObject({ ok: false, reason: 'schema' });
    if (!r.ok) expect(r.detail).toContain('duplicate');
  });

  it('非 ok 状态：需要 message，忽略 options', () => {
    expect(parseLlmContent('{"status":"unclear","message":""}')).toMatchObject({
      ok: false,
      reason: 'schema',
    });
    const r = parseLlmContent(
      JSON.stringify({ status: 'refused', message: '春风不便作答', options: [option('甲')] }),
    );
    expect(r).toEqual({ ok: true, value: { status: 'refused', message: '春风不便作答' } });
    expect(parseLlmContent('{"status":"weird","message":"x"}')).toMatchObject({
      ok: false,
      reason: 'schema',
    });
  });

  it('后处理：标题去引号与结尾标点，说明去 Markdown', () => {
    const r = parseLlmContent(
      JSON.stringify({
        status: 'ok',
        question_en: ' Q ',
        options: [
          { ...option(''), title: '“接下邀约。”' },
          { ...option(''), title: '「留在原地！」' },
          { ...option(''), title: '"谈一次加薪？"' },
          {
            ...option(''),
            title: '  先摸清   底细 ',
            desc: '# 标题\n- **先**摸清底细，再做决定，这是一段足够长的说明文字。',
          },
        ],
      }),
    );
    expect(r.ok).toBe(true);
    if (r.ok && r.value.status === 'ok') {
      expect(r.value.options.map((o) => o.title)).toEqual([
        '接下邀约',
        '留在原地',
        '谈一次加薪',
        '先摸清 底细',
      ]);
      expect(r.value.options[3]!.desc).toBe('标题 先摸清底细，再做决定，这是一段足够长的说明文字。');
      expect(r.value.questionEn).toBe('Q');
    }
  });

  it('工具函数', () => {
    expect(cleanTitle('『换个角度』；')).toBe('换个角度');
    expect(cleanDesc('**重点** 内容')).toBe('重点 内容');
    expect(titleKey('先谈加薪，再定去留')).toBe(titleKey('先谈加薪 再定去留'));
  });
});
