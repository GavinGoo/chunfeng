import { expect, test } from '@playwright/test';
import { gotoHome, recordStates, states, waitState } from './helpers';

// 14 §4.2 用例 9：错误路径（用 page.route 注入上游故障）

const fail = (status: number, code: string, retryable: boolean) => ({
  status,
  contentType: 'application/json',
  body: JSON.stringify({ error: { code, message: 'injected', retryable } }),
});

test('可重试错误 → 错误页 →「再试一次」复用 requestId 并成功', async ({ page }) => {
  const ids: string[] = [];
  let calls = 0;
  await page.route('**/api/readings', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    ids.push((route.request().postDataJSON() as { requestId: string }).requestId);
    calls += 1;
    // 前端会对 502 自动重试一次：前两次都失败才会进入错误页
    if (calls <= 2) return route.fulfill(fail(502, 'JEV_UNAVAILABLE', true));
    return route.continue();
  });
  await gotoHome(page);
  await page.getByRole('textbox').fill('要不要换个城市生活？');
  await page.getByRole('button', { name: '翻开属于你的那页' }).click();
  await waitState(page, 'open');
  await expect(page.getByText('风停了片刻').first()).toBeVisible();
  await expect(page).toHaveURL(/\/$/); // 非 ok 结果不改变地址

  await recordStates(page);
  await page.getByRole('button', { name: '再试一次' }).click();
  await expect(page).toHaveURL(/\/a\/[A-Za-z0-9_-]{12}$/, { timeout: 30_000 });
  await waitState(page, 'open');
  expect((await states(page)).dissolving).toBeDefined();
  await expect(page).toHaveURL(/\/a\/[A-Za-z0-9_-]{12}$/);
  expect(ids).toHaveLength(3);
  expect(new Set(ids).size).toBe(1);
});

test('服务配置错误（上游 401）→ 没有「再试一次」', async ({ page }) => {
  await page.route('**/api/readings', (route) =>
    route.request().method() === 'POST'
      ? route.fulfill(fail(503, 'SERVICE_MISCONFIGURED', false))
      : route.continue(),
  );
  await gotoHome(page);
  await page.getByRole('textbox').fill('要不要换个城市生活？');
  await page.getByRole('button', { name: '翻开属于你的那页' }).click();
  await waitState(page, 'open');
  await expect(page.getByText('春风暂时无法作答').first()).toBeVisible();
  await expect(page.getByRole('button', { name: '再试一次' })).toHaveCount(0);
  await page.getByRole('button', { name: '换个问题' }).first().click();
  await waitState(page, 'closed');
});

test('翻页中「合上」：取消请求，回到封面', async ({ page }) => {
  await page.route('**/api/readings', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    await new Promise((r) => setTimeout(r, 8000));
    return route.continue().catch(() => undefined);
  });
  await gotoHome(page);
  await page.getByRole('textbox').fill('要不要现在就出发？');
  await page.getByRole('button', { name: '翻开属于你的那页' }).click();
  await waitState(page, 'flipping');
  await page.getByRole('button', { name: '合上' }).click();
  await waitState(page, 'closed');
  await expect(page).toHaveURL(/\/$/);
});
