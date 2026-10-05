import { expect, test } from '@playwright/test';
import { ask, gotoHome, waitState } from './helpers';

// 14 §4.2 用例 10、11：减少动态效果与强制 CSS 引擎

test.describe('减少动态效果', () => {
  test.use({ reducedMotion: 'reduce' });
  test('流程完整，且没有翻页画布', async ({ page }) => {
    await gotoHome(page);
    await page.getByRole('textbox').fill('要不要早点睡？');
    await page.getByRole('button', { name: '翻开属于你的那页' }).click();
    await expect(page.locator('[data-flip-engine="reduced"]')).toHaveCount(1);
    await waitState(page, 'open');
    await expect(page.locator('[data-testid="flip-layer"] canvas')).toHaveCount(0);
    await expect(page).toHaveURL(/\/a\//);
  });
});

test('?flip=css：CSS 引擎下流程完整', async ({ page }) => {
  await gotoHome(page, '?flip=css');
  await page.getByRole('textbox').fill('要不要学吉他？');
  await page.getByRole('button', { name: '翻开属于你的那页' }).click();
  await expect(page.locator('[data-flip-engine="css"]')).toHaveCount(1);
  await expect(page.locator('[data-testid="flip-layer"] canvas')).toHaveCount(0);
  await waitState(page, 'open');
  await expect(page).toHaveURL(/\/a\//);
  // 落页后引擎已释放（16 §3.2）
  await expect(page.locator('[data-flip-engine]')).toHaveCount(0);
  // 再翻一次重建的仍是同一种引擎
  const url = page.url();
  await page.getByRole('button', { name: '再翻一次' }).click();
  await expect(page.locator('[data-flip-engine="css"]')).toHaveCount(1);
  await expect(page).not.toHaveURL(url, { timeout: 30_000 });
  await waitState(page, 'open');
  await expect(page.locator('[data-flip-engine]')).toHaveCount(0);
});

test('低矮横屏（844×390）：双页，合上的书比打开的页面大', async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 });
  await gotoHome(page);
  await expect(page.locator('[data-book-state]')).toHaveAttribute('data-book-mode', 'spread');
  const closed = await page.getByRole('region', { name: '春风之书的封面' }).boundingBox();
  expect(closed?.width ?? 0).toBeGreaterThan(240);
  await ask(page, '要不要去看海？');
  await expect(page.getByRole('button', { name: '再翻一次' })).toBeInViewport();
});
