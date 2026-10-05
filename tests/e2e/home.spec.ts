import { expect, test } from '@playwright/test';
import { gotoHome } from './helpers';

// 14 §4.2 用例 1：首页封面构图与空内容引导

test('封面：左上角主副标题，中部输入框，其下按钮；空内容点击出现引导', async ({ page }) => {
  await gotoHome(page);
  const cover = page.getByRole('region', { name: '春风之书的封面' });
  const box = await cover.boundingBox();
  const title = await page.getByRole('heading', { name: '春风' }).boundingBox();
  const subtitle = await page.getByText('遇事不决，可问春风').first().boundingBox();
  const input = await page.getByRole('textbox').boundingBox();
  const button = await page.getByRole('button', { name: '翻开属于你的那页' }).boundingBox();
  if (!box || !title || !subtitle || !input || !button) throw new Error('missing element');

  // 标题在封面左上：左侧 40%、上方 30% 以内
  expect(title.x - box.x).toBeLessThan(box.width * 0.4);
  expect(title.y - box.y).toBeLessThan(box.height * 0.3);
  expect(subtitle.y).toBeGreaterThan(title.y);
  // 输入框大致居中，按钮在其下方
  const inputMid = input.y + input.height / 2;
  expect(inputMid).toBeGreaterThan(box.y + box.height * 0.3);
  expect(inputMid).toBeLessThan(box.y + box.height * 0.7);
  expect(button.y).toBeGreaterThan(input.y + input.height - 1);

  // 空内容时按钮为 aria-disabled（仍可点击，以给出引导），Playwright 视其为不可用，需 force
  await page.getByRole('button', { name: '翻开属于你的那页' }).click({ force: true });
  await expect(page.getByText('先写下你的问题吧')).toBeVisible();
  await expect(page.locator('[data-book-state]')).toHaveAttribute('data-book-state', 'closed');
});

// 06 §3.2：书名用玄宗体子集「Chunfeng Title」（D20），首帧即已加载（preload + font-display: block）
test('封面书名使用 Chunfeng Title，且字体已加载', async ({ page }) => {
  await gotoHome(page);
  const title = page.getByRole('heading', { name: '春风' });
  await expect(title).toBeVisible();
  const fontFamily = await title
    .locator('[class*="face"]')
    .first()
    .evaluate((el) => getComputedStyle(el).fontFamily);
  expect(fontFamily).toMatch(/^"?Chunfeng Title"?/);
  await page.evaluate(() => document.fonts.ready);
  // document.fonts.check 对未声明的字体族也返回 true，所以直接检查 FontFace 的状态
  const loaded = await page.evaluate(() =>
    [...document.fonts].some((f) => f.family.replace(/"/g, '') === 'Chunfeng Title' && f.status === 'loaded'),
  );
  expect(loaded).toBe(true);
  await expect(page.locator('link[rel="preload"][href="/fonts/title.woff2"]')).toHaveCount(1);
});

// 06 §5.1、D41 / D42：标签页 icon 是透明底的 seal.png；iOS 主屏另用铺满纸色底的 apple-touch-icon.png
test('网页 icon 与 iOS 主屏图标', async ({ page, request }) => {
  await gotoHome(page);
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute('href', /\/seal\.png/);
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute(
    'href',
    /\/apple-touch-icon\.png/,
  );

  const seal = await request.get('/seal.png');
  expect(seal.status()).toBe(200);
  expect(seal.headers()['content-type']).toBe('image/png');
  expect((await seal.body()).subarray(16, 24)).toEqual(
    Buffer.from([0, 0, 2, 0, 0, 0, 2, 0]), // IHDR：512 × 512
  );

  const apple = await request.get('/apple-touch-icon.png');
  expect(apple.status()).toBe(200);
  expect(apple.headers()['content-type']).toBe('image/png');
  expect((await apple.body()).subarray(16, 24)).toEqual(
    Buffer.from([0, 0, 0, 180, 0, 0, 0, 180]), // IHDR：180 × 180
  );
});
