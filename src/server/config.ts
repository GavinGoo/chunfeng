import { z } from 'zod';

// env 解析（01 §8）。首次使用时才解析，避免 next build 阶段因缺少密钥而失败（13 §3）。

const bool = z
  .enum(['true', 'false', '1', '0', ''])
  .optional()
  .transform((v) => v === 'true' || v === '1');
const int = (def: number, min = 0) => z.coerce.number().int().min(min).default(def);
const num = (def: number) => z.coerce.number().finite().default(def);

const EnvSchema = z.object({
  NODE_ENV: z.string().default('development'),
  MOCK_UPSTREAMS: bool,
  MOCK_LATENCY_MS: int(2500),
  MOCK_FAIL: z.string().default(''),

  JEV_API_URL: z.string().url().optional(),
  JEV_API_KEY: z.string().min(1).optional(),
  JEV_MODEL: z.string().min(1).default('jev-1.13-free'),
  JEV_TIMEOUT_MS: int(8000, 100),

  LLM_API_URL: z.string().url().optional(),
  LLM_API_KEY: z.string().min(1).optional(),
  LLM_MODEL: z.string().min(1).optional(),
  LLM_THINKING: z.enum(['enabled', 'disabled']).default('disabled'),
  LLM_TEMPERATURE: num(1.0),
  LLM_MAX_TOKENS: int(1500, 100),
  LLM_TIMEOUT_MS: int(25000, 100),
  LLM_VISION: bool,

  READING_DEADLINE_MS: int(50000, 1000),
  SCORING_STRATEGY: z.enum(['blend', 'choice']).default('blend'),
  SCORING_BLEND_WEIGHT: num(0.6).pipe(z.number().min(0).max(1)),
  SCORING_SOFTMAX_TAU: num(0.25).pipe(z.number().positive()),

  DATABASE_PATH: z.string().min(1).default('./data/chunfeng.db'),
  SHARE_CACHE_DIR: z.string().min(1).default('./data/share-cache'),
  IMAGE_DIR: z.string().min(1).default('./data/images'),
  RATE_LIMIT_PER_MIN: int(8, 1),
  RATE_LIMIT_PER_DAY: int(100, 1),
  UPLOAD_RATE_LIMIT_PER_MIN: int(6, 1),
  UPLOAD_RATE_LIMIT_PER_DAY: int(60, 1),
  MAX_CONCURRENT_READINGS: int(16, 1),
  IP_HASH_SALT: z.string().min(1).optional(),
  READING_TTL_DAYS: int(0),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  LOG_CONTENT: bool,
});

type Env = z.infer<typeof EnvSchema>;

export interface AppConfig {
  isProd: boolean;
  mock: { enabled: boolean; latencyMs: number; fail: string };
  jev: { url: string; key: string; model: string; timeoutMs: number };
  llm: {
    url: string;
    key: string;
    model: string;
    thinking: 'enabled' | 'disabled';
    temperature: number;
    maxTokens: number;
    timeoutMs: number;
    /** LLM_VISION：LLM_MODEL 接受图片输入，允许用户附图（15 §4） */
    vision: boolean;
  };
  readingDeadlineMs: number;
  scoring: { strategy: 'blend' | 'choice'; blendWeight: number; softmaxTau: number };
  databasePath: string;
  shareCacheDir: string;
  imageDir: string;
  rateLimit: { perMin: number; perDay: number };
  uploadRateLimit: { perMin: number; perDay: number };
  maxConcurrentReadings: number;
  ipHashSalt: string;
  readingTtlDays: number;
  logLevel: Env['LOG_LEVEL'];
  logContent: boolean;
}

export class ConfigError extends Error {
  constructor(public readonly variables: string[]) {
    // 只列出变量名，绝不输出任何值
    super(`配置无效或缺失，请检查环境变量：${variables.join(', ')}`);
    this.name = 'ConfigError';
  }
}

export function parseConfig(source: Record<string, string | undefined>): AppConfig {
  // 空字符串视为未设置，便于 .env 中留空占位
  const cleaned = Object.fromEntries(Object.entries(source).filter(([, v]) => v !== undefined && v !== ''));
  const parsed = EnvSchema.safeParse(cleaned);
  if (!parsed.success) {
    const vars = [...new Set(parsed.error.issues.map((i) => String(i.path[0] ?? '?')))];
    throw new ConfigError(vars);
  }
  const e = parsed.data;
  const isProd = e.NODE_ENV === 'production';
  const mock = e.MOCK_UPSTREAMS;

  const missing: string[] = [];
  if (!mock) {
    for (const key of ['JEV_API_URL', 'JEV_API_KEY', 'LLM_API_URL', 'LLM_API_KEY', 'LLM_MODEL'] as const) {
      if (!e[key]) missing.push(key);
    }
  }
  if (isProd && !mock) {
    if (!e.IP_HASH_SALT || e.IP_HASH_SALT === 'change-me') missing.push('IP_HASH_SALT');
  }
  if (missing.length > 0) throw new ConfigError(missing);

  return Object.freeze({
    isProd,
    mock: { enabled: mock, latencyMs: e.MOCK_LATENCY_MS, fail: e.MOCK_FAIL },
    jev: {
      url: e.JEV_API_URL ?? 'http://mock.invalid/v1/systemone',
      key: e.JEV_API_KEY ?? '',
      model: e.JEV_MODEL,
      timeoutMs: e.JEV_TIMEOUT_MS,
    },
    llm: {
      url: e.LLM_API_URL ?? 'http://mock.invalid/chat/completions',
      key: e.LLM_API_KEY ?? '',
      model: e.LLM_MODEL ?? 'mock-llm',
      thinking: e.LLM_THINKING,
      temperature: e.LLM_TEMPERATURE,
      maxTokens: e.LLM_MAX_TOKENS,
      timeoutMs: e.LLM_TIMEOUT_MS,
      vision: e.LLM_VISION,
    },
    readingDeadlineMs: e.READING_DEADLINE_MS,
    scoring: {
      strategy: e.SCORING_STRATEGY,
      blendWeight: e.SCORING_BLEND_WEIGHT,
      softmaxTau: e.SCORING_SOFTMAX_TAU,
    },
    databasePath: e.DATABASE_PATH,
    shareCacheDir: e.SHARE_CACHE_DIR,
    imageDir: e.IMAGE_DIR,
    rateLimit: { perMin: e.RATE_LIMIT_PER_MIN, perDay: e.RATE_LIMIT_PER_DAY },
    uploadRateLimit: { perMin: e.UPLOAD_RATE_LIMIT_PER_MIN, perDay: e.UPLOAD_RATE_LIMIT_PER_DAY },
    maxConcurrentReadings: e.MAX_CONCURRENT_READINGS,
    ipHashSalt: e.IP_HASH_SALT ?? 'dev-salt',
    readingTtlDays: e.READING_TTL_DAYS,
    logLevel: e.LOG_LEVEL,
    logContent: e.LOG_CONTENT && !isProd,
  });
}

let cached: AppConfig | undefined;

export function getConfig(): AppConfig {
  cached ??= parseConfig(process.env);
  return cached;
}

/** 仅测试使用 */
export function resetConfigForTests(): void {
  cached = undefined;
}
