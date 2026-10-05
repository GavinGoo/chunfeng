import { expect, test } from '@playwright/test';
import { gotoHome, waitState } from './helpers';

// 书内透光、落页微光（09 §5.1）与金尘（11 §5.1）

const Q = '周末去海边，还是进山走走？';
const lumen = '[data-testid="lumen"]';
const dust = '[data-dust] > *';

test('光幕：翻页中透光，落页时微光，打开后关闭', async ({ page }) => {
  await gotoHome(page);
  await expect(page.locator(lumen)).toHaveAttribute('data-lumen', 'off');
  await page.evaluate((sel) => {
    const w = window as unknown as { __lumen: string[] };
    w.__lumen = [];
    const el = document.querySelector(sel);
    if (!el) return;
    new MutationObserver(() => {
      const v = el.getAttribute('data-lumen') ?? '';
      if (w.__lumen.at(-1) !== v) w.__lumen.push(v);
    }).observe(el, { attributes: true, attributeFilter: ['data-lumen'] });
  }, lumen);
  await page.getByRole('textbox').fill(Q);
  await page.getByRole('button', { name: '翻开属于你的那页' }).click();
  await waitState(page, 'open');
  await expect(page.locator(lumen)).toHaveAttribute('data-lumen', 'off');
  const seen = await page.evaluate(() => (window as unknown as { __lumen: string[] }).__lumen);
  expect(seen).toEqual(['flow', 'bloom', 'off']);
});

test('光幕：直达答案页（SSR）时不播放', async ({ page }) => {
  await gotoHome(page);
  await page.getByRole('textbox').fill(Q);
  await page.getByRole('button', { name: '翻开属于你的那页' }).click();
  await waitState(page, 'open');
  await page.reload();
  await waitState(page, 'open');
  await expect(page.locator(lumen)).toHaveAttribute('data-lumen', 'off');
});

test('金尘：显现时从提问升起，跳过后页内没有残留', async ({ page }) => {
  await gotoHome(page);
  await page.getByRole('textbox').fill(Q);
  await page.getByRole('button', { name: '翻开属于你的那页' }).click();
  await waitState(page, 'revealing');
  await expect.poll(() => page.locator(dust).count()).toBeGreaterThan(0);
  // 显现中按任意键跳到最终状态（11 §5）
  await page.keyboard.press('Shift');
  await waitState(page, 'open');
  await expect(page.locator(dust)).toHaveCount(0);
});

test.describe('减少动态效果', () => {
  test.use({ reducedMotion: 'reduce' });
  test('没有光幕与金尘，流程完整', async ({ page }) => {
    await gotoHome(page);
    await expect(page.locator(lumen)).toHaveCount(0);
    // 显现只有 200 ms：在页内记录整个过程中出现过的光幕与金尘节点
    await page.evaluate(
      ([l, d]) => {
        const w = window as unknown as { __lit: number };
        w.__lit = 0;
        new MutationObserver(() => {
          w.__lit = Math.max(w.__lit, document.querySelectorAll(`${l}, ${d}`).length);
        }).observe(document.body, { childList: true, subtree: true });
      },
      [lumen, dust],
    );
    await page.getByRole('textbox').fill(Q);
    await page.getByRole('button', { name: '翻开属于你的那页' }).click();
    await waitState(page, 'open');
    await expect(page.getByTestId('page-content')).toContainText('周末去海边');
    expect(await page.evaluate(() => (window as unknown as { __lit: number }).__lit)).toBe(0);
  });
});
