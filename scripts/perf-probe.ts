// pnpm perf:probe（16 §5.1）：前端资源占用探针。生产构建 + 模拟上游，测首页、翻页、答案页静置时的进程 CPU、
// 整机 GPU 利用率、渲染流水线（布局 / 绘制 / 栅格）、合成层与 GPU 进程内存，以及「打开」「显现」两个关键时刻的帧节奏。
// 参数：--no-build（沿用已有的 .next-perf）--only desktop|phone --port N（默认 3150）--window MS（每个场景的测量窗口，默认 8000）
//       --render <报告.json>（不测量，只按已有报告重新生成同名 .md）
// 输出：reports/perf/probe-<日期时刻>.json 与 .md（与上一份报告对照）。footprint 与 ioreg 只在 macOS 上可读，其他系统上留空。
// 会起一个 next start 实例（独立的数据库与缓存目录），结束时（含 Ctrl-C）停止实例并删除测试数据；端口被占用时直接退出，不碰别的进程。

import { type ChildProcess, execFile, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import path from 'node:path';
import { promisify } from 'node:util';
import { type Browser, type CDPSession, chromium, devices, type Page } from '@playwright/test';

const exec = promisify(execFile);
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

type Group = 'desktop' | 'phone';

interface Options {
  build: boolean;
  only: Set<Group>;
  port: number;
  windowMs: number;
  render?: string;
}

function parseArgs(argv: readonly string[]): Options {
  const out: Options = { build: true, only: new Set(['desktop', 'phone']), port: 3150, windowMs: 8000 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const value = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`参数 ${a} 缺少取值`);
      return v;
    };
    if (a === '--no-build') out.build = false;
    else if (a === '--only') {
      const g = value();
      if (g !== 'desktop' && g !== 'phone') throw new Error('--only 只能是 desktop 或 phone');
      out.only = new Set([g]);
    } else if (a === '--port') out.port = Number(value());
    else if (a === '--window') out.windowMs = Number(value());
    else if (a === '--render') out.render = value();
  }
  if (!Number.isInteger(out.port) || out.port <= 0) throw new Error('--port 需要正整数');
  if (!Number.isFinite(out.windowMs) || out.windowMs < 1000) throw new Error('--window 至少 1000');
  return out;
}

const opts = parseArgs(process.argv.slice(2));
const DIST = '.next-perf';
const NEXT_BIN = 'node_modules/next/dist/bin/next';
const DATA = [
  './data/perf.db',
  './data/perf.db-shm',
  './data/perf.db-wal',
  './data/perf-share-cache',
  './data/perf-images',
];
const REPORT_DIR = 'reports/perf';
const QUESTION = '要不要辞职去做自己喜欢的事？';
const IS_MAC = process.platform === 'darwin';
const TRACE_MS = 3000;
const LAYER_MS = 2000;
const base = `http://localhost:${opts.port}`;

const PROFILES: Record<Group, Parameters<Browser['newContext']>[0]> = {
  desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 },
  phone: (() => {
    const { defaultBrowserType: _ignored, ...d } = devices['iPhone 13'];
    return d;
  })(),
};

// ---------------------------------------------------------------------------
// 服务端实例

function portFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const srv = createServer();
    srv.once('error', () => resolve(false));
    srv.once('listening', () => srv.close(() => resolve(true)));
    srv.listen(port);
  });
}

function runToEnd(args: string[], env: NodeJS.ProcessEnv): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { env, stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`${args.join(' ')} 退出码 ${code}`)),
    );
  });
}

function cleanData(): void {
  for (const p of DATA) rmSync(p, { recursive: true, force: true });
}

let server: ChildProcess | null = null;
const serverLog: string[] = [];

async function startServer(): Promise<void> {
  if (!(await portFree(opts.port)))
    throw new Error(`端口 ${opts.port} 已被占用：请换 --port，或先停掉占用它的进程`);
  cleanData();
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: 'production',
    NEXT_DIST_DIR: DIST,
    MOCK_UPSTREAMS: 'true',
    // 翻页需要持续约 28 s，才放得下「打开」的追踪与翻页中的测量；单次超时与总预算相应放宽
    MOCK_LATENCY_MS: '28000',
    LLM_TIMEOUT_MS: '40000',
    READING_DEADLINE_MS: '60000',
    RATE_LIMIT_PER_MIN: '1000',
    RATE_LIMIT_PER_DAY: '10000',
    LLM_VISION: 'false',
    DATABASE_PATH: './data/perf.db',
    SHARE_CACHE_DIR: './data/perf-share-cache',
    IMAGE_DIR: './data/perf-images',
    LOG_LEVEL: 'warn',
  };
  const child = spawn(process.execPath, [NEXT_BIN, 'start', '-p', String(opts.port)], {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server = child;
  const keep = (b: Buffer) => {
    serverLog.push(b.toString());
    if (serverLog.length > 200) serverLog.shift();
  };
  child.stdout?.on('data', keep);
  child.stderr?.on('data', keep);
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) break;
    try {
      const res = await fetch(`${base}/api/health`);
      if (res.ok) return;
    } catch {
      // 尚未就绪
    }
    await sleep(500);
  }
  throw new Error(`实例未能就绪：\n${serverLog.join('')}`);
}

async function stopServer(): Promise<void> {
  const child = server;
  server = null;
  if (child && child.exitCode === null) {
    const exited = new Promise<void>((r) => child.once('exit', () => r()));
    child.kill('SIGTERM');
    await Promise.race([exited, sleep(10_000)]);
    if (child.exitCode === null) {
      child.kill('SIGKILL');
      await exited;
    }
  }
  cleanData();
}

process.once('SIGINT', () => {
  void stopServer().finally(() => process.exit(130));
});

// ---------------------------------------------------------------------------
// 指标

interface ProcInfo {
  type: string;
  id: number;
  cpuTime: number;
}

async function procInfo(bcdp: CDPSession): Promise<ProcInfo[]> {
  return (await bcdp.send('SystemInfo.getProcessInfo')).processInfo;
}

/** 每秒 CPU 毫秒（1000 = 一个核满载），按进程类型汇总 */
function cpuDelta(p0: ProcInfo[], p1: ProcInfo[], seconds: number): Record<string, number> {
  const by: Record<string, number> = {};
  for (const q of p1) {
    const prev = p0.find((x) => x.id === q.id);
    by[q.type] = (by[q.type] ?? 0) + q.cpuTime - (prev?.cpuTime ?? 0);
  }
  const out: Record<string, number> = {};
  let total = 0;
  for (const [k, v] of Object.entries(by)) {
    out[k] = Math.round((v * 1000) / seconds);
    total += out[k] ?? 0;
  }
  out.total = total;
  return out;
}

async function gpuUtil(): Promise<number | null> {
  if (!IS_MAC) return null;
  try {
    const { stdout } = await exec('ioreg', ['-r', '-d', '1', '-w', '0', '-c', 'IOAccelerator']);
    const m = /"Device Utilization %"=(\d+)/.exec(stdout);
    return m ? Number(m[1]) : null;
  } catch {
    return null;
  }
}

function sampleGpu(everyMs: number): () => number[] {
  const xs: number[] = [];
  let on = true;
  void (async () => {
    while (on) {
      const v = await gpuUtil();
      if (v !== null) xs.push(v);
      await sleep(everyMs);
    }
  })();
  return () => {
    on = false;
    return xs;
  };
}

const median = (xs: number[]): number | null => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? null;
};

const UNIT_MB: Record<string, number> = { B: 1 / 1048576, KB: 1 / 1024, MB: 1, GB: 1024 };

interface Footprint {
  footprintMB: number | null;
  ioAcceleratorMB: number;
  ioSurfaceMB: number;
}

/** GPU 进程的内存：总量，以及显存（IOAccelerator）与合成缓冲（IOSurface） */
async function footprint(pid: number): Promise<Footprint | null> {
  if (!IS_MAC) return null;
  try {
    const { stdout } = await exec('footprint', ['-p', String(pid)]);
    const total = /Footprint:\s+([\d.]+)\s*(KB|MB|GB|B)\b/.exec(stdout);
    const cats: Record<string, number> = {};
    const re =
      /^\s*([\d.]+)\s*(KB|MB|GB|B)\s+[\d.]+\s*(?:KB|MB|GB|B)\s+[\d.]+\s*(?:KB|MB|GB|B)\s+\d+\s+(.+?)\s*$/gm;
    for (const m of stdout.matchAll(re)) {
      const [, n, u, cat] = m;
      if (n && u && cat) cats[cat] = (cats[cat] ?? 0) + Number(n) * (UNIT_MB[u] ?? 0);
    }
    const pick = (r: RegExp) =>
      Number(
        Object.entries(cats)
          .filter(([k]) => r.test(k))
          .reduce((a, [, v]) => a + v, 0)
          .toFixed(1),
      );
    return {
      footprintMB:
        total?.[1] && total[2] ? Number((Number(total[1]) * (UNIT_MB[total[2]] ?? 0)).toFixed(1)) : null,
      ioAcceleratorMB: pick(/^IOAccelerator/),
      ioSurfaceMB: pick(/IOSurface/),
    };
  } catch {
    return null;
  }
}

interface TraceEvent {
  name: string;
  ph: string;
  pid: number;
  tid: number;
  ts?: number;
  dur?: number;
  args?: { name?: string; data?: { nodeId?: number } };
}

function parseTrace(buf: Buffer): TraceEvent[] {
  const json: unknown = JSON.parse(buf.toString());
  const list = Array.isArray(json)
    ? json
    : json && typeof json === 'object' && 'traceEvents' in json && Array.isArray(json.traceEvents)
      ? json.traceEvents
      : [];
  return list.filter(
    (e): e is TraceEvent =>
      !!e && typeof e === 'object' && typeof e.name === 'string' && typeof e.ph === 'string',
  );
}

const CATS = [
  'toplevel',
  'benchmark',
  'devtools.timeline',
  'disabled-by-default-devtools.timeline',
  'disabled-by-default-devtools.timeline.frame',
  'viz',
  'blink.user_timing',
];

interface TraceSummary {
  /** 线程忙碌（每秒毫秒），只列 ≥ 0.5 的 */
  busy: Record<string, number>;
  /** 事件次数（每秒） */
  perSec: Record<string, number>;
  /** 绘制次数（每秒），按节点 */
  paintBy: Record<string, number>;
  frames: number;
  /** 书进入 open / closed 之前、超过 25 ms 的合成帧间隔个数 */
  gapsOver25ms: number;
  maxGapMs: number | null;
  /** 超过 25 ms 的合成帧间隔各自发生在哪个状态之后（页面以 performance.mark('state:…') 标记）；书进入 open / closed 之后的不计 */
  gapsAt: string[];
  longTasksMs: number[];
}

const COUNTED = new Set([
  'Paint',
  'RasterTask',
  'UpdateLayoutTree',
  'Layout',
  'FireAnimationFrame',
  'TimerFire',
]);

function summarize(events: TraceEvent[], seconds: number): TraceSummary {
  const pname = new Map<number, string>();
  const tname = new Map<string, string>();
  for (const e of events) {
    if (e.ph !== 'M') continue;
    if (e.name === 'process_name' && e.args?.name) pname.set(e.pid, e.args.name);
    if (e.name === 'thread_name' && e.args?.name) tname.set(`${e.pid}:${e.tid}`, e.args.name);
  }
  const busy: Record<string, number> = {};
  const counts: Record<string, number> = {};
  const paintBy: Record<string, number> = {};
  const swaps: number[] = [];
  const longTasks: number[] = [];
  const marks: { name: string; ts: number }[] = [];
  for (const e of events) {
    if (e.ph === 'M' || e.ph === 'E') continue;
    const thread = `${pname.get(e.pid) ?? e.pid}/${tname.get(`${e.pid}:${e.tid}`) ?? e.tid}`;
    if (e.ph === 'X' && (e.name === 'ThreadControllerImpl::RunTask' || e.name === 'RunTask')) {
      busy[thread] = (busy[thread] ?? 0) + (e.dur ?? 0) / 1000;
      if (thread.endsWith('/CrRendererMain') && (e.dur ?? 0) > 16_000)
        longTasks.push(Math.round((e.dur ?? 0) / 1000));
    }
    if (e.name === 'Display::DrawAndSwap' && e.ph === 'X' && e.ts !== undefined) swaps.push(e.ts);
    if (e.name.startsWith('state:') && e.ts !== undefined && !marks.some((m) => m.name === e.name))
      marks.push({ name: e.name.slice(6), ts: e.ts });
    if (COUNTED.has(e.name)) counts[e.name] = (counts[e.name] ?? 0) + 1;
    if (e.name === 'Paint') {
      const id = String(e.args?.data?.nodeId ?? 'n/a');
      paintBy[id] = (paintBy[id] ?? 0) + 1;
    }
  }
  swaps.sort((a, b) => a - b);
  const gaps = swaps.slice(1).map((t, i) => (t - (swaps[i] ?? t)) / 1000);
  marks.sort((a, b) => a.ts - b.ts);
  // 书进入静止状态（open / closed）之后，背景按设计由约 30 Hz 的时钟推进（16 §3.8），帧间隔约 33 ms 不算长帧
  const settledAt = marks.find((m) => m.name === 'open' || m.name === 'closed')?.ts ?? Infinity;
  const gapsAt: string[] = [];
  let longGaps = 0;
  swaps.slice(1).forEach((t, i) => {
    const gap = (t - (swaps[i] ?? t)) / 1000;
    const start = swaps[i] ?? t;
    if (gap <= 25 || start >= settledAt) return;
    longGaps++;
    const m = [...marks].reverse().find((x) => x.ts <= start);
    gapsAt.push(
      `${gap.toFixed(0)} ms @ ${m ? `${m.name} +${((start - m.ts) / 1000).toFixed(0)} ms` : `起点 +${((start - (swaps[0] ?? start)) / 1000).toFixed(0)} ms`}`,
    );
  });
  const rate = (o: Record<string, number>, min = 0) =>
    Object.fromEntries(
      Object.entries(o)
        .map(([k, v]) => [k, Number((v / seconds).toFixed(1))] as const)
        .filter(([, v]) => v >= min)
        .sort((a, b) => b[1] - a[1]),
    );
  return {
    busy: rate(busy, 0.5),
    perSec: rate(counts),
    paintBy: rate(paintBy),
    frames: swaps.length,
    gapsOver25ms: longGaps,
    maxGapMs: gaps.length > 0 ? Number(Math.max(...gaps).toFixed(1)) : null,
    gapsAt,
    longTasksMs: longTasks.sort((a, b) => b - a).slice(0, 8),
  };
}

/** 节点的简短名字：标签名 + CSS Modules 类名（去掉模块前缀） */
async function describe(cdp: CDPSession, backendNodeId: number): Promise<string> {
  try {
    const { node } = await cdp.send('DOM.describeNode', { backendNodeId });
    const attrs = node.attributes ?? [];
    const i = attrs.indexOf('class');
    const cls = (i >= 0 ? (attrs[i + 1] ?? '') : '')
      .split(/\s+/)
      .map((c) => c.replace(/^.*?-module__[^_]+__/, '').replace(/^[a-zA-Z0-9]+_/, ''))
      .filter(Boolean)
      .join('.');
    return `${node.localName || node.nodeName}${cls ? `.${cls}` : ''}`;
  } catch {
    return `#${backendNodeId}`;
  }
}

async function nameNodes(
  cdp: CDPSession,
  byId: Record<string, number>,
  top = 6,
): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  // 节点 id 是整数形式的键，对象会按数值升序排列它们，所以这里重新按次数排序
  const sorted = Object.entries(byId).sort((a, b) => b[1] - a[1]);
  for (const [id, n] of sorted.slice(0, top)) {
    const name = id === 'n/a' ? 'n/a' : await describe(cdp, Number(id));
    out[name] = (out[name] ?? 0) + n;
  }
  return out;
}

interface LayerInfo {
  layerId: string;
  backendNodeId?: number;
  width: number;
  height: number;
  drawsContent: boolean;
  invisible?: boolean;
  paintCount?: number;
}

interface LayerStats {
  layers: number;
  drawn: number;
  /** 有内容的层按 DPR 全部栅格时的估算（MB） */
  estMB: number;
  /** 窗口内被重绘的层（每秒次数） */
  repaint: { node: string; size: string; perSec: number }[];
}

async function layerStats(cdp: CDPSession, dpr: number): Promise<LayerStats> {
  const tree: { latest: LayerInfo[] | null } = { latest: null };
  const on = (e: { layers?: LayerInfo[] }) => {
    if (e.layers) tree.latest = e.layers;
  };
  cdp.on('LayerTree.layerTreeDidChange', on);
  await cdp.send('LayerTree.enable');
  await sleep(400);
  const t0: LayerInfo[] = tree.latest ?? [];
  await sleep(LAYER_MS);
  const t1: LayerInfo[] = tree.latest ?? t0;
  await cdp.send('LayerTree.disable');
  cdp.off('LayerTree.layerTreeDidChange', on);
  const before = new Map(t0.map((l) => [l.layerId, l.paintCount ?? 0]));
  const drawn = t1.filter((l) => l.drawsContent && !l.invisible);
  const area = drawn.reduce((a, l) => a + l.width * l.height, 0);
  const repaint: LayerStats['repaint'] = [];
  for (const l of t1) {
    const d = (l.paintCount ?? 0) - (before.get(l.layerId) ?? 0);
    if (d <= 0 || t0.length === 0) continue;
    repaint.push({
      node: l.backendNodeId ? await describe(cdp, l.backendNodeId) : '(anon)',
      size: `${Math.round(l.width)}x${Math.round(l.height)}`,
      perSec: Number((d / (LAYER_MS / 1000)).toFixed(1)),
    });
  }
  return {
    layers: t1.length,
    drawn: drawn.length,
    estMB: Math.round((area * dpr * dpr * 4) / 1048576),
    repaint: repaint.sort((a, b) => b.perSec - a.perSec).slice(0, 8),
  };
}

interface Metrics {
  [name: string]: number;
}

async function metrics(cdp: CDPSession): Promise<Metrics> {
  const { metrics: list } = await cdp.send('Performance.getMetrics');
  return Object.fromEntries(list.map((m) => [m.name, m.value]));
}

interface Measurement {
  scenario: string;
  cpuMsPerSec: Record<string, number>;
  gpuUtilMedian: number | null;
  gpuProcess: Footprint | null;
  layoutsPerSec: number;
  jsHeapMB: number;
  trace: TraceSummary;
  layers: LayerStats;
  flipCanvas: string | null;
}

interface Ctx {
  browser: Browser;
  bcdp: CDPSession;
  page: Page;
  cdp: CDPSession;
  dpr: number;
}

async function gpuPid(bcdp: CDPSession): Promise<number | null> {
  return (await procInfo(bcdp)).find((p) => p.type === 'GPU')?.id ?? null;
}

async function measure(c: Ctx, scenario: string): Promise<Measurement> {
  process.stdout.write(`  · ${scenario} …`);
  const m0 = await metrics(c.cdp);
  const p0 = await procInfo(c.bcdp);
  const stopGpu = sampleGpu(250);
  const t0 = performance.now();
  await sleep(opts.windowMs);
  const seconds = (performance.now() - t0) / 1000;
  const p1 = await procInfo(c.bcdp);
  const samples = stopGpu();
  const m1 = await metrics(c.cdp);
  const pid = await gpuPid(c.bcdp);
  const mem = pid ? await footprint(pid) : null;

  await c.browser.startTracing(c.page, { categories: CATS });
  await sleep(TRACE_MS);
  const trace = summarize(parseTrace(await c.browser.stopTracing()), TRACE_MS / 1000);
  trace.paintBy = await nameNodes(c.cdp, trace.paintBy);
  const layers = await layerStats(c.cdp, c.dpr);
  const flipCanvas = await c.page.evaluate(() => {
    const cv = document.querySelector<HTMLCanvasElement>('[data-flip-engine] canvas');
    return cv ? `${cv.width}x${cv.height}` : null;
  });
  const out: Measurement = {
    scenario,
    cpuMsPerSec: cpuDelta(p0, p1, seconds),
    gpuUtilMedian: median(samples),
    gpuProcess: mem,
    layoutsPerSec: Number((((m1.LayoutCount ?? 0) - (m0.LayoutCount ?? 0)) / seconds).toFixed(1)),
    jsHeapMB: Number(((m1.JSHeapUsedSize ?? 0) / 1048576).toFixed(1)),
    trace,
    layers,
    flipCanvas,
  };
  const cpu = out.cpuMsPerSec;
  process.stdout.write(
    ` 渲染 ${cpu.renderer ?? 0} + GPU ${cpu.GPU ?? 0} ms/s，GPU ${out.gpuUtilMedian ?? '-'}%，绘制 ${trace.perSec.Paint ?? 0}/s，栅格 ${trace.perSec.RasterTask ?? 0}/s，GPU 进程 ${mem?.footprintMB ?? '-'} MB\n`,
  );
  return out;
}

interface Moment {
  scenario: string;
  /** 追踪时长（s） */
  seconds: number;
  trace: TraceSummary;
}

async function waitState(page: Page, state: string, timeout = 60_000): Promise<void> {
  await page.waitForFunction(
    (s) => document.querySelector('[data-book-state]')?.getAttribute('data-book-state') === s,
    state,
    { timeout },
  );
}

async function openPage(browser: Browser, group: Group, reduced = false) {
  const context = await browser.newContext({
    ...PROFILES[group],
    reducedMotion: reduced ? 'reduce' : 'no-preference',
  });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Performance.enable');
  await cdp.send('DOM.enable');
  await cdp.send('DOM.getDocument', { depth: 0 });
  return { context, page, cdp };
}

async function gotoReady(page: Page, url: string, state: string): Promise<void> {
  await page.goto(url);
  await page.locator('[data-ready="true"]').waitFor({ timeout: 60_000 });
  await waitState(page, state);
}

// ---------------------------------------------------------------------------
// 报告

interface Report {
  kind: 'perf-probe';
  when: string;
  build: 'production';
  platform: string;
  gpuDevice: string | null;
  browserVersion: string;
  windowMs: number;
  runs: Record<Group, { measurements: Measurement[]; moments: Moment[] } | undefined>;
}

/** 时间早于 before 的最近一份报告 */
function latestReport(before?: string): Report | null {
  if (!existsSync(REPORT_DIR)) return null;
  const files = readdirSync(REPORT_DIR)
    .filter((f) => /^probe-.*\.json$/.test(f))
    .sort();
  for (const f of files.reverse()) {
    try {
      const r = JSON.parse(readFileSync(path.join(REPORT_DIR, f), 'utf8')) as Partial<Report>;
      if (r.kind === 'perf-probe' && (before === undefined || (r.when ?? '') < before)) return r as Report;
    } catch {
      // 跳过损坏的文件
    }
  }
  return null;
}

function withDelta(now: number | null | undefined, prev: number | null | undefined): string {
  if (now === null || now === undefined) return '–';
  if (prev === null || prev === undefined) return String(now);
  const d = Math.round((now - prev) * 10) / 10;
  return `${now}（${d >= 0 ? '+' : ''}${d}）`;
}

function markdown(r: Report, prev: Report | null): string {
  const lines: string[] = [];
  lines.push(`# 前端资源占用探针 · ${r.when}`, '');
  lines.push(
    `生产构建 · ${r.platform} · ${r.gpuDevice ?? '未知 GPU'} · Chromium ${r.browserVersion} · 窗口 ${r.windowMs} ms`,
  );
  lines.push(prev ? `括号内为与上一份报告（${prev.when}）的差值。` : '没有上一份报告可对照。', '');
  for (const group of ['desktop', 'phone'] as const) {
    const g = r.runs[group];
    if (!g) continue;
    const pg = prev?.runs[group];
    lines.push(`## ${group === 'desktop' ? '桌面 1440×900@2' : '手机 390×664@3（iPhone 13 视口）'}`, '');
    lines.push(
      '| 场景 | 渲染进程 | GPU 进程 | GPU 利用率 | 布局 /s | 绘制 /s | 栅格任务 /s | 合成层 | GPU 进程内存 | 翻页画布 |',
    );
    lines.push('|---|---|---|---|---|---|---|---|---|---|');
    for (const m of g.measurements) {
      const p = pg?.measurements.find((x) => x.scenario === m.scenario);
      const prevRate = (name: string) => (p ? (p.trace.perSec[name] ?? 0) : undefined);
      lines.push(
        `| ${m.scenario} | ${withDelta(m.cpuMsPerSec.renderer, p?.cpuMsPerSec.renderer)} | ${withDelta(m.cpuMsPerSec.GPU, p?.cpuMsPerSec.GPU)} | ${withDelta(m.gpuUtilMedian, p?.gpuUtilMedian)} | ${withDelta(m.layoutsPerSec, p?.layoutsPerSec)} | ${withDelta(m.trace.perSec.Paint ?? 0, prevRate('Paint'))} | ${withDelta(m.trace.perSec.RasterTask ?? 0, prevRate('RasterTask'))} | ${m.layers.layers} | ${withDelta(m.gpuProcess?.footprintMB, p?.gpuProcess?.footprintMB)} | ${m.flipCanvas ?? '–'} |`,
      );
    }
    lines.push('', '逐帧（≥ 30 次/s）重绘的层：', '');
    let any = false;
    for (const m of g.measurements) {
      const hot = m.layers.repaint.filter((x) => x.perSec >= 30);
      if (hot.length === 0) continue;
      any = true;
      lines.push(`- ${m.scenario}：${hot.map((x) => `${x.node}（${x.size}，${x.perSec}/s）`).join('、')}`);
    }
    if (!any) lines.push('- 无');
    lines.push(
      '',
      '| 关键时刻 | 合成帧 | 帧间隔 > 25 ms | 最长帧间隔 | 栅格任务 | 布局 | 主要绘制 |',
      '|---|---|---|---|---|---|---|',
    );
    for (const mo of g.moments) {
      const t = mo.trace;
      const count = (perSec: number | undefined) => Math.round((perSec ?? 0) * mo.seconds);
      const paints = Object.entries(t.paintBy)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([k, v]) => `${k} ${count(v)}`)
        .join('、');
      lines.push(
        `| ${mo.scenario} | ${t.frames} | ${t.gapsOver25ms} | ${t.maxGapMs ?? '–'} ms | ${count(t.perSec.RasterTask)} | ${count(t.perSec.Layout)} | ${paints || '–'} |`,
      );
    }
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
}

// ---------------------------------------------------------------------------
// 场景

async function runGroup(browser: Browser, bcdp: CDPSession, group: Group) {
  const dpr = PROFILES[group]?.deviceScaleFactor ?? 1;
  const measurements: Measurement[] = [];
  const moments: Moment[] = [];
  console.log(`== ${group}`);

  for (const reduced of [false, true]) {
    const { context, page, cdp } = await openPage(browser, group, reduced);
    await gotoReady(page, `${base}/`, 'closed');
    await sleep(3500); // 进场动画与打字机起步
    measurements.push(
      await measure({ browser, bcdp, page, cdp, dpr }, reduced ? '首页静置·减少动态效果' : '首页静置'),
    );
    await context.close();
  }

  // 提问流程：打开（追踪）→ 翻页中 → 收尾与显现（追踪）→ 答案页静置
  let readingUrl: string | null = null;
  {
    const { context, page, cdp } = await openPage(browser, group);
    await gotoReady(page, `${base}/`, 'closed');
    await sleep(2500);
    const box = page.getByRole('textbox');
    if (group === 'phone') await box.tap();
    await box.fill(QUESTION);
    await sleep(1500); // 输入浮现结束
    // 状态变化打进追踪，供定位长帧间隔（gapsAt）
    await page.evaluate(() => {
      const el = document.querySelector('[data-book-state]');
      if (!el) return;
      new MutationObserver(() => performance.mark(`state:${el.getAttribute('data-book-state')}`)).observe(
        el,
        {
          attributes: true,
          attributeFilter: ['data-book-state'],
        },
      );
    });
    const btn = page.getByRole('button', { name: '翻开属于你的那页' });

    await browser.startTracing(page, { categories: CATS });
    const t0 = performance.now();
    if (group === 'phone') await btn.tap();
    else await btn.click();
    await waitState(page, 'flipping');
    await sleep(1200);
    let seconds = (performance.now() - t0) / 1000;
    const opening = summarize(parseTrace(await browser.stopTracing()), seconds);
    opening.paintBy = await nameNodes(cdp, opening.paintBy);
    moments.push({
      scenario: '打开（点击 → 起翻后 1.2 s）',
      seconds: Number(seconds.toFixed(2)),
      trace: opening,
    });

    measurements.push(await measure({ browser, bcdp, page, cdp, dpr }, '翻页中'));

    await waitState(page, 'settling', 90_000);
    await browser.startTracing(page, { categories: CATS });
    const t1 = performance.now();
    await waitState(page, 'open', 30_000);
    await sleep(500);
    seconds = (performance.now() - t1) / 1000;
    const reveal = summarize(parseTrace(await browser.stopTracing()), seconds);
    reveal.paintBy = await nameNodes(cdp, reveal.paintBy);
    moments.push({
      scenario: '收尾与显现（settling → open 后 0.5 s）',
      seconds: Number(seconds.toFixed(2)),
      trace: reveal,
    });

    readingUrl = page.url();
    await sleep(3500); // 落页微光、操作区淡入
    measurements.push(await measure({ browser, bcdp, page, cdp, dpr }, '答案页静置（翻页后）'));
    await context.close();
  }

  if (readingUrl) {
    const { context, page, cdp } = await openPage(browser, group);
    await gotoReady(page, readingUrl, 'open');
    await sleep(3000);
    measurements.push(await measure({ browser, bcdp, page, cdp, dpr }, '答案页静置（直达）'));
    await context.close();
  }
  return { measurements, moments };
}

// ---------------------------------------------------------------------------

if (opts.render) {
  const r = JSON.parse(readFileSync(opts.render, 'utf8')) as Report;
  const md = opts.render.replace(/\.json$/, '.md');
  writeFileSync(md, markdown(r, latestReport(r.when)));
  console.log(`已重新生成 ${md}`);
  process.exit(0);
}

let exitCode = 0;
try {
  if (opts.build) {
    console.log(`构建 ${DIST} …`);
    await runToEnd([NEXT_BIN, 'build'], { ...process.env, NEXT_DIST_DIR: DIST });
  } else if (!existsSync(path.join(DIST, 'BUILD_ID'))) {
    throw new Error(`没有找到 ${DIST}：去掉 --no-build 先构建一次`);
  }
  await startServer();
  console.log(`实例已就绪：${base}`);

  const browser = await chromium.launch({
    channel: 'chromium',
    args: IS_MAC
      ? ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-gpu-rasterization']
      : ['--enable-gpu-rasterization'],
  });
  const bcdp = await browser.newBrowserCDPSession();
  const info = await bcdp.send('SystemInfo.getInfo');
  const report: Report = {
    kind: 'perf-probe',
    when: new Date().toISOString(),
    build: 'production',
    platform: `${process.platform}-${process.arch}`,
    gpuDevice: info.gpu.devices[0]?.deviceString ?? null,
    browserVersion: browser.version(),
    windowMs: opts.windowMs,
    runs: { desktop: undefined, phone: undefined },
  };
  try {
    for (const group of ['desktop', 'phone'] as const) {
      if (opts.only.has(group)) report.runs[group] = await runGroup(browser, bcdp, group);
    }
  } finally {
    await browser.close();
  }

  const prev = latestReport();
  mkdirSync(REPORT_DIR, { recursive: true });
  const stamp = report.when.slice(0, 16).replace(/[-:]/g, '').replace('T', '-');
  const jsonFile = path.join(REPORT_DIR, `probe-${stamp}.json`);
  writeFileSync(jsonFile, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(jsonFile.replace(/\.json$/, '.md'), markdown(report, prev));
  console.log(`报告：${jsonFile}（及同名 .md）`);
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  exitCode = 1;
} finally {
  await stopServer();
}
process.exit(exitCode);
