import { expect, type Page, test } from '@playwright/test';
import sharp from 'sharp';
import { NOVISION_PORT } from '../../playwright.config';
import { ask, gotoHome, readingIdFromUrl, stage, waitState } from './helpers';

// 图片提问（15 §16.4）：主实例 LLM_VISION=true；另一实例 LLM_VISION=false

let pngCache: Buffer | undefined;
async function png(): Promise<Buffer> {
  pngCache ??= await sharp({
    create: { width: 1200, height: 900, channels: 3, background: '#2b5d44' },
  })
    .composite([
      {
        input: await sharp({ create: { width: 500, height: 700, channels: 3, background: '#d8c7a0' } })
          .png()
          .toBuffer(),
        left: 640,
        top: 100,
      },
    ])
    .png()
    .toBuffer();
  return pngCache;
}

const slot = (page: Page) =>
  page
    .locator('[data-status]')
    .filter({ has: page.locator('button') })
    .first();
const attachButton = (page: Page) => page.getByTestId('attach-button');
const thumb = (page: Page) => page.getByTestId('attach-thumb');

async function attach(page: Page): Promise<void> {
  await page
    .getByTestId('attach-input')
    .setInputFiles({ name: 'coats.png', mimeType: 'image/png', buffer: await png() });
  await expect(thumb(page)).toBeVisible();
  await expect(slot(page)).toHaveAttribute('data-status', 'ready', { timeout: 15_000 });
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => sessionStorage.clear());
});

test('封面：点进输入框后才出现附图按钮，文字不重排；附图 → 预览 → 删除', async ({ page }) => {
  await gotoHome(page);
  const box = page.getByRole('textbox');
  // 桌面端自动聚焦后也没有
  await expect(attachButton(page)).toBeHidden();
  await box.fill('');
  // 等封面进场（上浮 12 px）结束再量位置；背景的无限循环动画不算
  await page.waitForFunction(() =>
    document
      .getAnimations()
      .every((a) => a.effect?.getComputedTiming().endTime === Infinity || a.playState !== 'running'),
  );
  const before = await box.boundingBox();
  await box.click();
  await expect(attachButton(page)).toBeVisible();
  expect(await box.boundingBox()).toEqual(before);
  await expect(attachButton(page)).toHaveAccessibleName('附上一张图片');

  // 按下附图按钮不抢走输入框的焦点；焦点离开铭牌、打字机重新开始时按钮随之隐藏
  const chooser = page.waitForEvent('filechooser');
  await attachButton(page).click();
  await chooser;
  await expect(box).toBeFocused();
  await expect(attachButton(page)).toBeVisible();
  await page.mouse.click(5, 5);
  await expect(attachButton(page)).toBeHidden();
  await box.click();
  await expect(attachButton(page)).toBeVisible();

  await attach(page);
  await expect(thumb(page)).toBeVisible();
  await thumb(page).click();
  const viewer = page.getByTestId('image-viewer');
  await expect(viewer.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(viewer).toBeHidden();

  await page.getByTestId('attach-remove').click();
  await expect(attachButton(page)).toBeVisible();
  await expect(attachButton(page)).toBeFocused();
});

test('移动端：一次点按即可聚焦输入框；附图按钮在点按结束后才出现，不会截走这次点按', async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, '只在触屏视口验证');
  await gotoHome(page);
  const box = page.getByRole('textbox');
  let chooser = false;
  page.on('filechooser', () => {
    chooser = true;
  });
  // 两轮：首次点按，以及失焦、打字机重新开始之后再点按；点在附图按钮将要出现的左端
  for (let round = 0; round < 2; round++) {
    await expect(attachButton(page)).toBeHidden();
    await box.tap({ position: { x: 20, y: 20 } });
    await expect(box).toBeFocused();
    await expect(attachButton(page)).toBeVisible();
    await page.mouse.click(5, 5);
  }
  expect(chooser).toBe(false);
});

test('带图提问：答案页有相片，可放大；刷新后 SSR 首屏仍有；再翻一次沿用；访客可见', async ({
  page,
  browser,
  request,
}) => {
  await gotoHome(page);
  await page.getByRole('textbox').click();
  await attach(page);
  await ask(page, '这两件哪件更适合明天面试？');
  const photo = page.getByTestId('answer-photo').first();
  await expect(photo).toBeVisible();
  await expect(photo).toHaveAccessibleName(/^放大查看图片：/);
  const id = readingIdFromUrl(page.url());
  const tilt = await photo.evaluate((el) => (el as HTMLElement).style.getPropertyValue('--tilt'));

  await photo.click();
  await expect(page.getByTestId('image-viewer').getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(photo).toBeFocused();

  // SSR：HTML 已含相片
  const html = await (await request.get(`/a/${id}`)).text();
  expect(html).toContain(`/api/readings/${id}/image?size=thumb`);
  await page.reload();
  await expect(page.getByTestId('answer-photo').first()).toBeVisible();
  // 同一条答案两次打开的倾斜角相同
  expect(
    await page
      .getByTestId('answer-photo')
      .first()
      .evaluate((el) => (el as HTMLElement).style.getPropertyValue('--tilt')),
  ).toBe(tilt);

  // 附图草稿已随答案清除
  expect(await page.evaluate(() => sessionStorage.getItem('chunfeng:draft-image'))).toBeNull();

  await page.getByRole('button', { name: '再翻一次' }).click();
  await expect(stage(page)).toHaveAttribute('data-book-state', 'open', { timeout: 30_000 });
  await expect.poll(() => page.url()).not.toContain(id);
  await expect(page.getByTestId('answer-photo').first()).toBeVisible();

  const visitor = await browser.newContext();
  const vp = await visitor.newPage();
  await vp.goto(`/a/${id}`);
  await expect(vp.getByTestId('answer-photo').first()).toBeVisible();
  await expect(vp.getByRole('button', { name: '我也问问春风' })).toBeVisible();
  await visitor.close();
});

test('上传失败时点缩略图重试；不支持的文件给出提示', async ({ page }) => {
  await gotoHome(page);
  await page.getByRole('textbox').click();
  let failed = false;
  await page.route('**/api/uploads', async (route) => {
    if (failed) return route.continue();
    failed = true;
    await route.fulfill({
      status: 422,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'IMAGE_UNREADABLE', message: 'x', retryable: false } }),
    });
  });
  await page
    .getByTestId('attach-input')
    .setInputFiles({ name: 'a.png', mimeType: 'image/png', buffer: await png() });
  await expect(slot(page)).toHaveAttribute('data-status', 'failed');
  await expect(page.getByText('这张图片打不开，换一张试试，轻触缩略图重试')).toBeVisible();
  await expect(thumb(page)).toHaveAccessibleName('重试上传图片');
  await thumb(page).click();
  await expect(slot(page)).toHaveAttribute('data-status', 'ready', { timeout: 15_000 });

  await page.getByTestId('attach-remove').click();
  await page.getByTestId('attach-input').setInputFiles({
    name: 'notes.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('not an image'),
  });
  await expect(page.getByText('暂不支持这种图片，换一张 JPG 或 PNG 试试，轻触缩略图重试')).toBeVisible();
});

test('只附图不写字：引导写一句；刷新后草稿（文字与图片）恢复，缩略图直接可见', async ({ page }) => {
  await gotoHome(page);
  await page.getByRole('textbox').click();
  await attach(page);
  // 空内容时按钮为 aria-disabled（仍可点击，以给出引导），需 force
  await page.getByRole('button', { name: '翻开属于你的那页' }).click({ force: true });
  await expect(page.getByText('写一句你想问的，春风才知道从何看起')).toBeVisible();
  await waitState(page, 'closed');

  await page.getByRole('textbox').fill('周末穿哪件？');
  await page.waitForTimeout(400); // 草稿防抖
  await page.reload();
  await expect(stage(page)).toHaveAttribute('data-ready', 'true');
  await expect(page.getByRole('textbox')).toHaveValue('周末穿哪件？');
  await expect(thumb(page)).toBeVisible();
  await expect(slot(page)).toHaveAttribute('data-status', 'ready');
});

test('LLM_VISION=false：点进输入框后也没有附图入口', async ({ page }) => {
  await page.goto(`http://localhost:${NOVISION_PORT}/`);
  await expect(stage(page)).toHaveAttribute('data-ready', 'true');
  await page.getByRole('textbox').click();
  await page.keyboard.type('要不要');
  await expect(attachButton(page)).toHaveCount(0);
  const health = await (await page.request.get(`http://localhost:${NOVISION_PORT}/api/health`)).json();
  expect(health.vision).toBe('off');
});
