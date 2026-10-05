import { getConfig } from '../config';
import { faultResponse, hashString, mockDelay, mockStats, seeded, takeFault } from '../mock/faults';
import { softmax } from './scoring';
import type { JevRequest } from './types';

// 模拟 JEV：基于「问题 + 选项」哈希生成稳定的概率与评分，响应结构与官方一致。

function optionText(v: unknown): string {
  return typeof v === 'string' ? v : JSON.stringify(v);
}

export const mockJevFetch: typeof fetch = async (_input, init) => {
  const cfg = getConfig();
  mockStats(cfg.mock.fail).jevCalls++;
  const req = JSON.parse(String(init?.body ?? '{}')) as JevRequest;
  if (req.state && typeof req.state === 'object' && 'image' in req.state)
    mockStats(cfg.mock.fail).jevImageCalls++;
  const fault = takeFault('jev', cfg.mock.fail);
  await mockDelay(Math.min(600, Math.round(cfg.mock.latencyMs / 4)), init?.signal);
  if (fault) {
    if (fault.kind === 'network') throw new TypeError('fetch failed (mock)');
    const res = faultResponse(fault, 'jev');
    if (res) return res;
  }

  const stateKey = JSON.stringify(req.state);
  const quality = (text: string) => seeded(hashString(stateKey + text))();
  const answers: Record<string, unknown> = {};
  for (const [key, q] of Object.entries(req.questions ?? {})) {
    if (fault?.kind === 'bad' && key === 'fit_o4') continue;
    if (q.type === 'choice') {
      const keys = Object.keys(q.criteria);
      const probs = softmax(
        keys.map((k) => quality(optionText(q.criteria[k]))),
        0.12,
      );
      const probabilities = Object.fromEntries(keys.map((k, i) => [k, Number(probs[i]!.toFixed(4))]));
      const top = keys[probs.indexOf(Math.max(...probs))]!;
      answers[key] = { type: 'choice', choice: top, confidence: Math.max(...probs), probabilities };
    } else if (q.type === 'score') {
      const instr = q.instructions as { option?: unknown };
      const mean = 0.8 + quality(optionText(instr.option)) * 2.8;
      const weights = q.criteria.map((_, i) => Math.exp(-((i - mean) ** 2) / 0.9));
      const sum = weights.reduce((a, b) => a + b, 0);
      const probs = weights.map((w) => w / sum);
      const score = probs.reduce((acc, p, i) => acc + p * i, 0);
      answers[key] = {
        type: 'score',
        score: Number(score.toFixed(4)),
        confidence: Math.max(...probs),
        probabilities: Object.fromEntries(probs.map((p, i) => [String(i), Number(p.toFixed(4))])),
      };
    } else {
      answers[key] = { type: 'noul', noul: quality(key) };
    }
  }
  return Response.json(
    { model: req.model, answers, usage: { input_tokens: 1500, output_tokens: 0 } },
    { headers: { 'x-request-id': `mock-jev-${Date.now().toString(36)}` } },
  );
};
