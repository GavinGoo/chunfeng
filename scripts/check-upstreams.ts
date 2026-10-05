// pnpm check:upstreams（13 §4）：检查 JEV 网关与 LLM 的连通性。
// 只打印状态码、耗时与提示，绝不打印密钥或请求内容。会产生极少费用。
// LLM_VISION=true 时额外检查图片输入（15 §15）。

import { connect } from 'node:net';
import { loadScriptEnv, scrubSecrets } from '../src/server/scriptEnv';

loadScriptEnv();

const TIMEOUT_MS = 15_000;
let failures = 0;

function line(ok: boolean, label: string, detail: string): void {
  if (!ok) failures++;
  console.log(`${ok ? '✔' : '✘'} ${label.padEnd(26)} ${detail}`);
}

function hintFor(source: 'jev' | 'llm', status: number): string {
  if (status === 401) return '密钥无效（检查 API_KEY）';
  if (status === 402)
    return source === 'jev'
      ? '上游余额不足（网关 upstream_error），需充值或改用 jev-1.13-free'
      : '账户余额不足';
  if (status === 400)
    return source === 'jev'
      ? '请求被拒绝：模型可能不可路由（不要用 jev-latest）'
      : '请求格式错误（检查 LLM_MODEL 与参数）';
  if (status === 404) return '地址不存在（检查 *_API_URL 是否为完整 endpoint）';
  if (status === 422) return '请求校验失败';
  if (status === 429) return '被限流，稍后再试';
  if (status >= 500) return '上游服务异常或过载';
  return '';
}

async function errorSummary(res: Response): Promise<string> {
  try {
    const text = await res.text();
    const j = JSON.parse(text) as { error?: { type?: string; message?: string } | string; message?: string };
    const e = typeof j.error === 'object' ? j.error : undefined;
    const msg = e?.message ?? (typeof j.error === 'string' ? j.error : j.message) ?? '';
    return scrubSecrets(`${e?.type ? `${e.type}: ` : ''}${msg}`.slice(0, 160));
  } catch {
    return '';
  }
}

async function timed(url: string, init: RequestInit): Promise<{ res?: Response; ms: number; err?: string }> {
  const t0 = performance.now();
  try {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
    return { res, ms: Math.round(performance.now() - t0) };
  } catch (e) {
    const cause = (e as { cause?: { code?: string } }).cause?.code;
    const name = (e as Error).name;
    return {
      ms: Math.round(performance.now() - t0),
      err: name === 'TimeoutError' ? '超时' : (cause ?? name),
    };
  }
}

function tcpCheck(host: string, port: number): Promise<{ ok: boolean; ms: number; err?: string }> {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const socket = connect({ host, port, timeout: 5000 });
    const done = (ok: boolean, err?: string) => {
      socket.destroy();
      resolve({ ok, ms: Math.round(performance.now() - t0), err });
    };
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false, '连接超时'));
    socket.once('error', (e: NodeJS.ErrnoException) => done(false, e.code ?? e.message));
  });
}

async function checkJev(): Promise<void> {
  const url = process.env.JEV_API_URL;
  const key = process.env.JEV_API_KEY;
  const model = process.env.JEV_MODEL || 'jev-1.13-free';
  console.log('— JEV（TypeSafe /v1/systemone，经网关）');
  if (!url || !key) {
    line(false, 'JEV 配置', '缺少 JEV_API_URL 或 JEV_API_KEY');
    return;
  }
  const u = new URL(url);
  const port = Number(u.port || (u.protocol === 'https:' ? 443 : 80));

  // 1. 地址能否连通
  const tcp = await tcpCheck(u.hostname, port);
  line(
    tcp.ok,
    '1. 网关可达',
    tcp.ok ? `TCP ${u.hostname}:${port} ${tcp.ms} ms` : `${tcp.err}（需要内网或 VPN）`,
  );
  if (!tcp.ok) return;

  // 2. GET /v1/models 中是否有 JEV_MODEL
  const modelsUrl = `${u.origin}${u.pathname.replace(/\/systemone\/?$/, '/models')}`;
  const m = await timed(modelsUrl, { headers: { Authorization: `Bearer ${key}` } });
  if (!m.res) {
    line(false, '2. GET /v1/models', `${m.err}，${m.ms} ms`);
  } else if (!m.res.ok) {
    line(false, '2. GET /v1/models', `HTTP ${m.res.status}，${m.ms} ms ${hintFor('jev', m.res.status)}`);
  } else {
    const body = (await m.res.json().catch(() => ({}))) as { data?: { id?: string }[] };
    const ids = (body.data ?? []).map((d) => d.id);
    const has = ids.includes(model);
    line(
      has,
      '2. 模型列表',
      `HTTP 200，${m.ms} ms，共 ${ids.length} 个模型，${has ? '包含' : '不包含'} ${model}`,
    );
  }

  // 3. 最小的 /v1/systemone 请求
  const s = await timed(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      state: { forecast: 'Chance of rain today: 80%.' },
      questions: {
        umbrella: {
          type: 'choice',
          instructions: 'Should the person take an umbrella when going out today?',
          criteria: { o1: 'Take an umbrella', o2: 'Leave the umbrella at home' },
        },
      },
    }),
  });
  if (!s.res) {
    line(false, '3. POST /v1/systemone', `${s.err}，${s.ms} ms`);
    return;
  }
  const rid = s.res.headers.get('x-request-id');
  if (s.res.ok) {
    const body = (await s.res.json().catch(() => ({}))) as {
      model?: string;
      answers?: Record<string, unknown>;
    };
    const ok = !!body.answers?.umbrella;
    line(
      ok,
      '3. POST /v1/systemone',
      `HTTP 200，${s.ms} ms，model=${body.model ?? '?'}${ok ? '' : '（响应缺少 answers）'}`,
    );
  } else {
    const summary = await errorSummary(s.res);
    line(
      false,
      '3. POST /v1/systemone',
      `HTTP ${s.res.status}，${s.ms} ms ${hintFor('jev', s.res.status)}${summary ? ` | ${summary}` : ''}${rid ? ` | X-Request-Id ${rid}` : ''}`,
    );
  }
}

async function checkLlm(): Promise<void> {
  const url = process.env.LLM_API_URL;
  const key = process.env.LLM_API_KEY;
  const model = process.env.LLM_MODEL;
  console.log('— LLM（OpenAI 兼容 chat/completions）');
  if (!url || !key || !model) {
    line(false, 'LLM 配置', '缺少 LLM_API_URL、LLM_API_KEY 或 LLM_MODEL');
    return;
  }
  const r = await timed(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: 'You are a health check. Reply with a JSON object only.' },
        { role: 'user', content: 'Return {"ok":true} as json.' },
      ],
      response_format: { type: 'json_object' },
      thinking: { type: process.env.LLM_THINKING || 'disabled' },
      max_tokens: 20,
      stream: false,
    }),
  });
  if (!r.res) {
    line(false, 'POST chat/completions', `${r.err}，${r.ms} ms`);
    return;
  }
  if (r.res.ok) {
    const body = (await r.res.json().catch(() => ({}))) as {
      model?: string;
      choices?: { message?: { content?: string } }[];
    };
    const ok = typeof body.choices?.[0]?.message?.content === 'string';
    line(
      ok,
      'POST chat/completions',
      `HTTP 200，${r.ms} ms，model=${body.model ?? '?'}${ok ? '' : '（响应缺少 content）'}`,
    );
  } else {
    const summary = await errorSummary(r.res);
    line(
      false,
      'POST chat/completions',
      `HTTP ${r.res.status}，${r.ms} ms ${hintFor('llm', r.res.status)}${summary ? ` | ${summary}` : ''}`,
    );
  }
}

/** LLM_VISION=true 时（15 §15）：发送一张 64×64 的小图，开启 JSON 模式、关闭思考，确认输出可解析并含 image_en */
async function checkLlmVision(): Promise<void> {
  const v = process.env.LLM_VISION;
  if (v !== 'true' && v !== '1') return;
  const url = process.env.LLM_API_URL;
  const key = process.env.LLM_API_KEY;
  const model = process.env.LLM_MODEL;
  console.log('— LLM 图片输入（LLM_VISION=true）');
  if (!url || !key || !model) {
    line(false, 'LLM 配置', '缺少 LLM_API_URL、LLM_API_KEY 或 LLM_MODEL');
    return;
  }
  const sharp = (await import('sharp')).default;
  const jpg = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#1f5f3a' } })
    .jpeg()
    .toBuffer();
  const r = await timed(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: 'You are a health check. Reply with a JSON object only.' },
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${jpg.toString('base64')}` } },
            { type: 'text', text: 'Describe the image in a few words. Return {"image_en":"..."} as json.' },
          ],
        },
      ],
      response_format: { type: 'json_object' },
      thinking: { type: 'disabled' },
      max_tokens: 60,
      stream: false,
    }),
  });
  if (!r.res) {
    line(false, '图片 + JSON 模式', `${r.err}，${r.ms} ms`);
    return;
  }
  if (r.res.ok) {
    const body = (await r.res.json().catch(() => ({}))) as { choices?: { message?: { content?: string } }[] };
    let imageEn = '';
    try {
      imageEn = String(
        (JSON.parse(body.choices?.[0]?.message?.content ?? '{}') as { image_en?: unknown }).image_en ?? '',
      );
    } catch {
      imageEn = '';
    }
    line(
      imageEn.length > 0,
      '图片 + JSON 模式',
      `HTTP 200，${r.ms} ms${imageEn ? '，输出含 image_en' : '（输出无法解析或缺少 image_en）'}`,
    );
  } else {
    const summary = await errorSummary(r.res);
    const hint =
      r.res.status === 400
        ? '当前模型可能不支持图片输入（检查 LLM_VISION 与 LLM_MODEL）'
        : hintFor('llm', r.res.status);
    line(
      false,
      '图片 + JSON 模式',
      `HTTP ${r.res.status}，${r.ms} ms ${hint}${summary ? ` | ${summary}` : ''}`,
    );
  }
}

await checkJev();
await checkLlm();
await checkLlmVision();
console.log(failures === 0 ? '\n全部通过。' : `\n${failures} 项未通过。`);
process.exitCode = failures === 0 ? 0 : 1;
