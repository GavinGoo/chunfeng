import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT ?? 3100);
/** LLM_VISION=false 的第二个实例（15 §16.4） */
export const NOVISION_PORT = PORT + 1;

const common = {
  MOCK_UPSTREAMS: 'true',
  MOCK_LATENCY_MS: '300',
  RATE_LIMIT_PER_MIN: '1000',
  RATE_LIMIT_PER_DAY: '10000',
  UPLOAD_RATE_LIMIT_PER_MIN: '1000',
  UPLOAD_RATE_LIMIT_PER_DAY: '10000',
};

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    // 品质档位固定为 full（16 §3.12）：无头浏览器是软件渲染，首次翻页本来就低于 50 fps，会触发运行时降档。
    // 测运行时降档的用例自行清空
    storageState: {
      cookies: [],
      origins: [PORT, NOVISION_PORT].map((p) => ({
        origin: `http://localhost:${p}`,
        localStorage: [{ name: 'chunfeng:perf-tier-override', value: 'full' }],
      })),
    },
  },
  projects: [
    { name: 'iphone', use: { ...devices['iPhone 13'], browserName: 'chromium' } },
    { name: 'desktop', use: { viewport: { width: 1440, height: 900 } } },
  ],
  webServer: [
    {
      // 主实例开启图片提问：既有用例在开关开启时同样通过（附图入口只在点进输入框后出现）
      command: `pnpm exec next dev -p ${PORT}`,
      port: PORT,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        ...common,
        // 独立的构建目录：与本机正在运行的 pnpm dev（.next）互不锁定
        NEXT_DIST_DIR: '.next-e2e',
        LLM_VISION: 'true',
        IMAGE_DIR: './data/e2e-images',
        DATABASE_PATH: './data/e2e.db',
        SHARE_CACHE_DIR: './data/e2e-share-cache',
      },
    },
    {
      command: `pnpm exec next dev -p ${NOVISION_PORT}`,
      port: NOVISION_PORT,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        ...common,
        LLM_VISION: 'false',
        NEXT_DIST_DIR: '.next-novision',
        DATABASE_PATH: './data/e2e-novision.db',
        SHARE_CACHE_DIR: './data/e2e-novision-share-cache',
      },
    },
  ],
});
