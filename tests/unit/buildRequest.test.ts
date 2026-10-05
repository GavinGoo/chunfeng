import { describe, expect, it } from 'vitest';
import { buildJevRequest, MAX_BRIEF_CHARS, redactJevRequest } from '@/server/jev/buildRequest';
import { CHOICE_INSTRUCTIONS, FIT_LEVELS, QUESTION_KEYS } from '@/server/jev/questions';

const input = {
  model: 'jev-1.13-free',
  question: '要不要换工作？',
  questionEn: 'Should the asker change jobs?',
  briefsEn: ['brief one', 'brief two', 'brief three', 'brief four'] as const,
};

describe('buildJevRequest（03 §3.2）', () => {
  it('带图：state 增加 image（截断到 800 字符），六道题不变（15 §9）', () => {
    const plain = buildJevRequest(input);
    const req = buildJevRequest({
      ...input,
      imageEn: 'Two coats: a dark green wool coat and a beige hoodie.',
    });
    expect(req.state).toEqual({
      question: 'Should the asker change jobs?',
      question_original: '要不要换工作？',
      image: 'Two coats: a dark green wool coat and a beige hoodie.',
    });
    expect(req.questions).toEqual(plain.questions);
    expect(
      (buildJevRequest({ ...input, imageEn: 'x'.repeat(900) }).state as { image: string }).image,
    ).toHaveLength(800);
    // 无图（含空字符串）时不出现 image 键，请求体与改动前逐字节相同
    expect(JSON.stringify(buildJevRequest({ ...input, imageEn: '' }))).toBe(JSON.stringify(plain));
  });

  it('六个问题、键名与结构符合文档', () => {
    const req = buildJevRequest(input);
    expect(Object.keys(req.questions)).toEqual([...QUESTION_KEYS]);
    expect(req.model).toBe('jev-1.13-free');
    expect(req.state).toEqual({
      question: 'Should the asker change jobs?',
      question_original: '要不要换工作？',
    });
    expect(req.questions.best_fwd).toEqual({
      type: 'choice',
      instructions: CHOICE_INSTRUCTIONS,
      criteria: { o1: 'brief one', o2: 'brief two', o3: 'brief three', o4: 'brief four' },
    });
    expect(req.questions.fit_o3).toEqual({
      type: 'score',
      instructions: {
        question: 'How wise would it be for the asker to take this option, given the question in state?',
        option: 'brief three',
      },
      criteria: [...FIT_LEVELS],
    });
    expect(FIT_LEVELS).toHaveLength(5);
  });

  it('JSON 序列化后反序题 criteria 的键序为 o4→o1', () => {
    const json = JSON.stringify(buildJevRequest(input));
    const parsed = JSON.parse(json) as { questions: Record<string, { criteria: Record<string, string> }> };
    expect(Object.keys(parsed.questions.best_fwd!.criteria)).toEqual(['o1', 'o2', 'o3', 'o4']);
    expect(Object.keys(parsed.questions.best_rev!.criteria)).toEqual(['o4', 'o3', 'o2', 'o1']);
    // 值与键对应（反序只改变顺序，不改变映射）
    expect(parsed.questions.best_rev!.criteria.o4).toBe('brief four');
    // 在原始字符串中也确认顺序
    const rev = json.slice(json.indexOf('"best_rev"'));
    expect(rev.indexOf('"o4"')).toBeLessThan(rev.indexOf('"o1"'));
  });

  it('brief 超过 500 字符时截断', () => {
    const long = 'x'.repeat(800);
    const req = buildJevRequest({ ...input, briefsEn: [long, 'b', 'c', 'd'] });
    const c = req.questions.best_fwd as { criteria: Record<string, string> };
    expect(c.criteria.o1).toHaveLength(MAX_BRIEF_CHARS);
  });

  it('脱敏后的请求体不含原文与选项文本', () => {
    const red = JSON.stringify(redactJevRequest(buildJevRequest(input)));
    expect(red).not.toContain('要不要换工作');
    expect(red).not.toContain('brief one');
    expect(red).toContain('best_rev');
  });

  it('请求体快照', () => {
    expect(buildJevRequest(input)).toMatchSnapshot();
  });
});
