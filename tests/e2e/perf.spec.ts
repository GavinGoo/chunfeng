import { type CDPSession, expect, type Page, test } from '@playwright/test';
import { ask, gotoHome, waitState } from './helpers';

// 16 §5.2：资源占用的守卫。只在 desktop 项目（Chromium）上运行：要用 CDP 读计数与追踪

test.beforeEach(({ browserName }, info) => {
  test.skip(browserName !== 'chromium' || info.project.name !== 'desktop', '只在桌面 Chromium 上测');
});

const TRACE_MS = 2000;

async function layoutCount(cdp: CDPSession): Promise<number> {
  const { metrics } = (await cdp.send('Performance.getMetrics')) as {
    metrics: { name: string; value: number }[];
  };
  return metrics.find((m) => m.name === 'LayoutCount')?.value ?? 0;
}

/** 追踪 TRACE_MS，返回每秒的布局次数与栅格任务数 */
async function measureIdle(page: Page): Promise<{ layouts: number; rasters: number }> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  const browser = page.context().browser();
  if (!browser) throw new Error('no browser');
  const before = await layoutCount(cdp);
  await browser.startTracing(page, { categories: ['disabled-by-default-devtools.timeline'] });
  await page.waitForTimeout(TRACE_MS);
  const buf = await browser.stopTracing();
  const layouts = (await layoutCount(cdp)) - before;
  const json = JSON.parse(buf.toString()) as { traceEvents?: { name?: string; ph?: string }[] };
  const rasters = (json.traceEvents ?? []).filter((e) => e.name === 'RasterTask' && e.ph !== 'E').length;
  await cdp.detach();
  const s = TRACE_MS / 1000;
  return { layouts: layouts / s, rasters: rasters / s };
}

test('首页静置不逐帧重绘（复盘 2026-10-03-star-chart-repaint）', async ({ page }) => {
  await gotoHome(page);
  await page.waitForTimeout(3000);
  const { layouts, rasters } = await measureIdle(page);
  test.info().annotations.push({ type: 'idle', description: `布局 ${layouts}/s，栅格任务 ${rasters}/s` });
  // 修复前约 61 次与 314 个每秒；阈值留出打字机与光标的余量
  expect(layouts, '布局（次/s）').toBeLessThanOrEqual(15);
  expect(rasters, '栅格任务（个/s）').toBeLessThanOrEqual(75);
});

test('答案页释放翻页引擎，不可见的无限动画都已暂停', async ({ page }) => {
  await gotoHome(page);
  await ask(page, '要不要换个城市生活？');
  await page.waitForTimeout(3000);
  await expect(page.locator('[data-testid="flip-layer"] canvas')).toHaveCount(0);
  await expect(page.locator('[data-testid="flip-layer"] [data-flip-engine]')).toHaveCount(0);

  // 正在运行的无限动画只能来自背景（16 §3.4）：封面、光幕里一个都不能有
  const outside = await page.evaluate(() =>
    document
      .getAnimations()
      .filter((a) => a.playState === 'running' && a.effect?.getComputedTiming().iterations === Infinity)
      .map((a) => {
        const effect = a.effect as KeyframeEffect | null;
        const target = effect?.target;
        if (target?.closest('[data-testid="ambient"]')) return null;
        const name = a instanceof CSSAnimation ? a.animationName : a.id;
        return `${name} @ ${target?.getAttribute('class') ?? '?'}${effect?.pseudoElement ?? ''}`;
      })
      .filter((x) => x !== null),
  );
  expect(outside).toEqual([]);
});

// 星点纹理画在 canvas 里，不做 CSS 平铺背景（16 §3.13，复盘 2026-10-06-reveal-tile-oom-flash）：
// 字体加载会让整页重新栅格，三层星点若占瓦片显存，开书后的瓦片需求会超出上限，书页整片缺块闪黑
test('星空远景与两层亮星是已画好的 canvas，不占瓦片显存', async ({ page }) => {
  await gotoHome(page);
  const textures = page.locator('[data-testid="ambient"] canvas[data-star-texture]');
  await expect(textures).toHaveCount(3);
  // 每层都画上了星点（图片加载完才画）：取左上 1024 px 见方，数不透明的像素
  const minLit = () =>
    textures.evaluateAll((list) =>
      Math.min(
        ...list.map((el) => {
          const c = el as HTMLCanvasElement;
          const ctx = c.getContext('2d');
          if (!ctx || c.width === 0 || c.height === 0) return 0;
          const { data } = ctx.getImageData(0, 0, Math.min(c.width, 1024), Math.min(c.height, 1024));
          let lit = 0;
          for (let i = 3; i < data.length; i += 4) if ((data[i] ?? 0) > 0) lit++;
          return lit;
        }),
      ),
    );
  await expect.poll(minLit, { message: '画布上的星点像素' }).toBeGreaterThan(0);
  // 背景里不再有星点 PNG 的 CSS 背景
  const cssStars = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-testid="ambient"] *'))
      .map((el) => getComputedStyle(el).backgroundImage)
      .filter((bg) => /stars\.png|glint-[ab]\.png/.test(bg)),
  );
  expect(cssStars).toEqual([]);
});

// 品质档位 lite（16 §3.12，D31）
const ambient = '[data-testid="ambient"]';
/** 微粒画布（星点纹理也是 canvas，见 16 §3.13，不计入） */
const particles = `${ambient} canvas:not([data-star-texture])`;

test('?tier=lite：没有微粒与光幕，亮星不呼吸，背景的旋转与漂移照常', async ({ page }) => {
  await gotoHome(page, '?tier=lite');
  await expect(page.locator(ambient)).toHaveAttribute('data-tier', 'lite');
  await expect(page.locator(particles)).toHaveCount(0);
  const names = await page.evaluate(
    (sel) =>
      document
        .querySelector(sel)
        ?.getAnimations({ subtree: true })
        .filter((a) => a instanceof CSSAnimation && a.playState !== 'idle')
        .map((a) => (a as CSSAnimation).animationName.replace(/^.*__/, '')) ?? [],
    ambient,
  );
  expect(names.some((n) => n.startsWith('glint'))).toBe(false);
  expect(names.filter((n) => n.startsWith('drift')).length).toBe(3);
  expect(names.filter((n) => n.startsWith('twinkle')).length).toBe(7);

  // 整个提问流程中都没有出现过光幕
  await page.evaluate(() => {
    const w = window as unknown as { __lumen: number };
    w.__lumen = 0;
    new MutationObserver(() => {
      w.__lumen = Math.max(w.__lumen, document.querySelectorAll('[data-testid="lumen"]').length);
    }).observe(document.body, { childList: true, subtree: true });
  });
  await ask(page, '要不要学游泳？');
  expect(await page.evaluate(() => (window as unknown as { __lumen: number }).__lumen)).toBe(0);
});

test.describe('运行时降档', () => {
  // 不固定档位（配置里默认固定为 full）
  test.use({ storageState: { cookies: [], origins: [] } });
  test('首次翻页低于 50 fps：本次会话降为 lite，在书进入 open 时生效', async ({ page }) => {
    await gotoHome(page);
    await expect(page.locator(ambient)).toHaveAttribute('data-tier', 'full');
    await expect(page.locator(particles)).toHaveCount(1);
    const cdp = await page.context().newCDPSession(page);
    await page.getByRole('textbox').fill('要不要学滑板？');
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 20 });
    await page.getByRole('button', { name: '翻开属于你的那页' }).click();
    // 翻页途中不切换档位
    await waitState(page, 'settling', 60_000);
    await expect(page.locator(ambient)).toHaveAttribute('data-tier', 'full');
    await waitState(page, 'open', 60_000);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    await expect(page.locator(ambient)).toHaveAttribute('data-tier', 'lite', { timeout: 5000 });
    await expect(page.locator(particles)).toHaveCount(0);
    expect(await page.evaluate(() => sessionStorage.getItem('chunfeng:perf-tier'))).toBe('lite');
    await cdp.detach();
  });
});
