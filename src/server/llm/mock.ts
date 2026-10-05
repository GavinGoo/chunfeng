import { getConfig } from '../config';
import { faultResponse, hashString, mockDelay, mockStats, seeded, takeFault } from '../mock/faults';
import { type ChatMessage, messageText } from './prompt';

// 模拟 LLM（MOCK_UPSTREAMS=true）：按问题哈希确定性地选出 4 个选项，返回 OpenAI 兼容的响应。
// 支持数组形式的 content（带图提问，15 §8.5）：有图片部件时额外输出 image_en 与 image_alt。

export const MOCK_IMAGE_EN =
  'A photo attached by the asker (mock): two candidate items side by side, each with a distinct color and a short printed label.';
export const MOCK_IMAGE_ALT = '一张随问题附上的图片（模拟）';

interface MockOption {
  title: string;
  desc: string;
  brief_en: string;
}

const POOL: MockOption[] = [
  {
    title: '现在就迈出第一步',
    desc: '犹豫的时间越长，心里的声音就越嘈杂。不妨先做一件最小的事，让局面动起来；行动会带来新的信息，也会让你更清楚自己真正想要什么。代价是可能要为仓促付出一些学费。',
    brief_en:
      'Act now by taking the smallest concrete step; gains momentum and new information, at the risk of acting before fully thinking it through.',
  },
  {
    title: '按兵不动，再观察一阵',
    desc: '有些答案需要时间才会显现。给自己两周，只观察、不决定，把每天的感受记下来。等情绪沉淀，你会看得更清楚；只是要留意，别让等待变成逃避。',
    brief_en:
      'Hold off for two weeks and simply observe, keeping notes; allows emotions to settle and clarity to grow, but risks turning waiting into avoidance.',
  },
  {
    title: '找信任的人聊一聊',
    desc: '当局者迷，旁观者清。约一位了解你、又愿意说真话的朋友或前辈，把来龙去脉讲给 TA 听。说出口的过程本身就是整理，别人的一句提问，也许正好点破你的盲区。',
    brief_en:
      'Talk it through with a trusted friend or mentor who will be honest; gains an outside perspective and clarity, but relies on finding the right person.',
  },
  {
    title: '换个角度重新定义问题',
    desc: '也许真正的问题并不在眼前这两个选项之间。退后一步问问自己：我最在意的是什么？当答案变了，选项也会随之改变，路可能比你想象的更宽。',
    brief_en:
      'Step back and reframe the problem around what matters most; may reveal better options, though it delays a concrete decision.',
  },
  {
    title: '给自己定一个期限',
    desc: '悬而未决最耗人心神。给这件事定一个明确的截止日，在那之前尽量收集信息，到期就按当时的判断做决定。期限会逼你聚焦，也能让你从反复纠结中解脱出来。',
    brief_en:
      'Set a firm deadline, gather information until then, and decide on that date; limits rumination and forces focus, but may feel rushed.',
  },
  {
    title: '先做一个小小的试验',
    desc: '与其在脑海里反复推演，不如用低成本的方式试一试：花一个周末、一小笔钱，或一次简短的尝试。真实的体验比想象可靠，即便结果不理想，损失也在可承受的范围之内。',
    brief_en:
      'Run a small, low-cost experiment to test the option in real life; provides real evidence with limited downside, though small tests may not fully represent the real thing.',
  },
  {
    title: '把得失写在纸上',
    desc: '把每条路的收获与代价一一写下，再为它们标上分量。纸面会让模糊的焦虑变得具体，也常常让你发现，某个顾虑其实没有那么重要。写完之后，答案往往已经浮现。',
    brief_en:
      'Write down the gains and costs of each path and weigh them; turns vague anxiety into concrete trade-offs, but analysis alone may not capture feelings.',
  },
  {
    title: '听从最初的直觉',
    desc: '问题出现的那一刻，心里其实已经有了倾向。直觉是经验压缩成的判断，未必完美，却往往诚实。顺着它走，至少这是你自己选的路；只是别忘了为可能的意外留一条退路。',
    brief_en:
      "Follow the asker's first instinct; honors accumulated experience and personal values, but may overlook facts that careful analysis would catch.",
  },
  {
    title: '选择更难的那条路',
    desc: '更难的路往往意味着更大的成长。若你此刻有余力，不妨接受挑战，让自己被推着向前。代价是更多的压力与不确定，所以动身之前，先确认身边有能托住你的人。',
    brief_en:
      'Choose the harder, more demanding path for greater growth; builds capability and confidence, at the cost of more stress and uncertainty.',
  },
  {
    title: '选择让自己安心的路',
    desc: '安心本身就是一种珍贵的收获。选那条让你夜里睡得着的路，把精力留给更重要的事。它也许不够耀眼，但稳定会给你积蓄力量的时间，等时机成熟再出发也不迟。',
    brief_en:
      'Choose the path that brings peace of mind and stability; preserves energy and reduces stress, but may forgo a bigger opportunity.',
  },
  {
    title: '先照顾好眼前的生活',
    desc: '有时候，纠结是因为太累了。先把睡眠、饮食和手头的事安顿好，等心力恢复，再回来面对这个问题。一个休息过的头脑，做出的决定往往更清醒，也更少后悔。',
    brief_en:
      'Put the decision aside briefly and restore basic well-being first; a rested mind decides better, though the issue remains unresolved for now.',
  },
  {
    title: '问问一年后的自己',
    desc: '想象一年后的你回望今天，会希望自己做了哪个选择？这个问题能帮你跳出眼前的得失，看见更长远的在意。答案未必轻松，却多半更接近你真心想要的方向。',
    brief_en:
      'Imagine looking back a year from now and choose what that future self would endorse; emphasizes long-term values over short-term comfort.',
  },
];

function extractTag(content: string, tag: string): string | undefined {
  const m = content.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
  return m?.[1]?.trim();
}

function imageParts(m: ChatMessage): string[] {
  if (typeof m.content === 'string') return [];
  return m.content.flatMap((p) => (p.type === 'image_url' ? [p.image_url.url] : []));
}

function buildContent(messages: ChatMessage[]): { content: string; repair: boolean; hasImage: boolean } {
  const users = messages.filter((m) => m.role === 'user');
  const last = users[users.length - 1];
  const repair = !!last && messageText(last).startsWith('上面的 JSON 有以下问题');
  const withQuestion = [...users].reverse().find((m) => messageText(m).includes('<question>'));
  const text = withQuestion ? messageText(withQuestion) : '';
  const q = withQuestion ? (extractTag(text, 'question') ?? '') : '';
  const previous = withQuestion ? extractTag(text, 'previous') : undefined;
  const images = withQuestion ? imageParts(withQuestion) : [];
  for (const url of images) {
    if (!url.startsWith('data:image/jpeg;base64,'))
      throw new Error('mock llm: image must be a JPEG data URL');
  }
  const hasImage = images.length > 0;
  const imageFields = (ok: boolean) =>
    hasImage ? { image_en: ok ? MOCK_IMAGE_EN : '', image_alt: ok ? MOCK_IMAGE_ALT : '' } : {};

  if (/违法|犯罪|炸药|毒品/.test(q)) {
    return {
      content: JSON.stringify({
        status: 'refused',
        message: '这一页，春风不便翻开。',
        question_en: '',
        options: [],
        ...imageFields(false),
      }),
      repair,
      hasImage,
    };
  }
  if (/人身安全|伤害自己|伤害别人/.test(q)) {
    return {
      content: JSON.stringify({
        status: 'sensitive',
        message: '谢谢你愿意写下这些，此刻你值得被好好照顾。',
        question_en: '',
        options: [],
        ...imageFields(false),
      }),
      repair,
      hasImage,
    };
  }
  // 注意：不能用 \W 判断乱码，JS 中所有汉字都属于 \W
  if (
    /^(你好|您好|hi|hello|嗨|[a-z]{1,3})$/i.test(q) ||
    /^[\p{P}\p{S}\p{N}\s]+$/u.test(q) ||
    /^[a-z]{12,}$/i.test(q)
  ) {
    return {
      content: JSON.stringify({
        status: 'unclear',
        message: '春风没有听清你的困惑，换个说法再问一次吧。',
        question_en: '',
        options: [],
        ...imageFields(false),
      }),
      repair,
      hasImage,
    };
  }

  const prevTitles = new Set(
    (previous ?? '')
      .split('\n')
      .map((l) => l.replace(/^\d+\.\s*/, '').trim())
      .filter(Boolean),
  );
  const rand = seeded(hashString(q + (previous ?? '')));
  const candidates = POOL.filter((o) => !prevTitles.has(o.title));
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j]!, candidates[i]!];
  }
  const options = candidates.slice(0, 4);
  return {
    content: JSON.stringify({
      status: 'ok',
      message: '',
      question_en: `The asker is facing this question and wants guidance: ${q.slice(0, 120)}`,
      options,
      ...imageFields(true),
    }),
    repair,
    hasImage,
  };
}

function completion(content: string | null, finishReason = 'stop'): Response {
  return Response.json(
    {
      id: `mock-${Date.now().toString(36)}`,
      object: 'chat.completion',
      model: 'mock-llm',
      choices: [{ index: 0, finish_reason: finishReason, message: { role: 'assistant', content } }],
      usage: { prompt_tokens: 1800, completion_tokens: 600, prompt_cache_hit_tokens: 1500 },
    },
    { headers: { 'x-request-id': `mock-llm-${Date.now().toString(36)}` } },
  );
}

function mockError(status: number, message: string, type: string): Response {
  return new Response(JSON.stringify({ error: { message, type, code: type, param: null } }), {
    status,
    headers: { 'content-type': 'application/json', 'x-request-id': `mock-llm-${Date.now().toString(36)}` },
  });
}

export const mockLlmFetch: typeof fetch = async (_input, init) => {
  const cfg = getConfig();
  const stats = mockStats(cfg.mock.fail);
  stats.llmCalls++;
  const body = JSON.parse(String(init?.body ?? '{}')) as { messages?: ChatMessage[] };
  const { content, repair, hasImage } = buildContent(body.messages ?? []);
  if (repair) stats.llmRepairCalls++;
  if (hasImage) stats.llmImageCalls++;

  const fault = takeFault('llm', cfg.mock.fail);
  if (fault?.kind === 'timeout') {
    await mockDelay(10 * 60_000, init?.signal);
  }
  await mockDelay(fault ? Math.min(200, cfg.mock.latencyMs) : cfg.mock.latencyMs, init?.signal);
  if (fault) {
    if (fault.kind === 'network') throw new TypeError('fetch failed (mock)');
    const res = faultResponse(fault, 'llm');
    if (res) return res;
    if (fault.kind === 'empty') return completion('');
    if (fault.kind === 'length') return completion(content.slice(0, content.length / 2), 'length');
    if (fault.kind === 'badjson') return completion(`${content.slice(0, 40)}`);
    // 风控拦截（15 §8.5）：服务商风格的 400
    if (fault.kind === 'filter') return mockError(400, 'Content Exists Risk', 'invalid_request_error');
    // 模型不接受图片输入
    if (fault.kind === 'novision')
      return mockError(400, 'This model does not support image input', 'invalid_request_error');
    if (fault.kind === 'schema') {
      const broken = JSON.parse(content) as { options?: unknown[] };
      broken.options = broken.options?.slice(0, 3);
      return completion(JSON.stringify(broken));
    }
  }
  return completion(content);
};
