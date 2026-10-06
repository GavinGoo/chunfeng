import { expect, test } from '@playwright/test';
import {
  ask,
  bookState,
  gotoHome,
  pageText,
  readingIdFromUrl,
  recordStates,
  stage,
  states,
  waitState,
} from './helpers';

// 14 §4.2 用例 2、3、5、6、7，以及答案页 SSR（11 §9 最后一条）

const Q = '工作三年了，要不要跳槽去创业公司？';

test('提问流程：翻页 → 显现 → /a/:id → 刷新后仍是同一答案', async ({ page }) => {
  await gotoHome(page);
  await recordStates(page);
  await page.getByRole('textbox').fill(Q);
  await page.getByRole('button', { name: '翻开属于你的那页' }).click();
  // 结果很快时会从 opening 直接进入 settling（跳过 flipping），因此不等待 flipping
  // 翻页层出现（任一引擎）
  await expect(page.locator('[data-testid="flip-layer"] [data-flip-engine]')).toHaveCount(1);
  await expect(page.getByTestId('flipping-hint')).toContainText('春风正在翻书');
  await waitState(page, 'open');
  const seen = await states(page);
  for (const s of ['opening', 'settling', 'revealing', 'open']) expect(seen[s]).toBeDefined();

  await expect(page).toHaveURL(/\/a\/[A-Za-z0-9_-]{12}$/);
  await expect(page).toHaveTitle(/^春风 · 工作三年了/);
  const id = readingIdFromUrl(page.url());
  const before = await pageText(page);
  expect(before).toContain('工作三年了');
  await expect(stage(page)).toHaveAttribute('data-owner', 'true');

  await page.reload();
  await waitState(page, 'open');
  expect(readingIdFromUrl(page.url())).toBe(id);
  expect(await pageText(page)).toContain('工作三年了');
  await expect(page.getByRole('button', { name: '再翻一次' })).toBeVisible();
});

test('最短翻页时长：结果很快返回时，从点击到开始显现 ≥ 2.4 s', async ({ page }) => {
  await gotoHome(page);
  await recordStates(page);
  await page.getByRole('textbox').fill('周末去海边，还是进山？');
  const t0 = await page.evaluate(() => performance.now());
  await page.getByRole('button', { name: '翻开属于你的那页' }).click();
  await waitState(page, 'open');
  const seen = await states(page);
  expect(seen.revealing).toBeDefined();
  expect((seen.revealing ?? 0) - t0).toBeGreaterThanOrEqual(2400);
});

test('再翻一次：新的 id 与选项，地址被替换；后退合上书', async ({ page }) => {
  await gotoHome(page);
  await ask(page, '今晚该不该向 TA 表白？');
  const id1 = readingIdFromUrl(page.url());
  const text1 = await pageText(page);
  const len = await page.evaluate(() => history.length);

  await page.getByRole('button', { name: '再翻一次' }).click();
  await waitState(page, 'dissolving', 5_000).catch(() => undefined);
  await expect(page).not.toHaveURL(new RegExp(id1), { timeout: 30_000 });
  await waitState(page, 'open');
  const id2 = readingIdFromUrl(page.url());
  expect(id2).not.toBe(id1);
  expect(await pageText(page)).not.toBe(text1);
  expect(await page.evaluate(() => history.length)).toBe(len);

  // 14 §4.2 用例 6：后退 → 书合上，回到封面
  await page.goBack();
  await waitState(page, 'closed');
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('button', { name: '翻开属于你的那页' })).toBeVisible();
  // 前进：取回答案，只翻一页后显现
  await page.goForward();
  await waitState(page, 'open');
  expect(readingIdFromUrl(page.url())).toBe(id2);
});

test('换个问题：书合上，铭牌清空', async ({ page }) => {
  await gotoHome(page);
  await ask(page, '要不要养一只猫？');
  await page.getByRole('button', { name: '换个问题' }).click();
  await waitState(page, 'closed');
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('textbox')).toHaveValue('');
});

test('回车提交：显现后焦点落在提问标题上，但不画焦点环（复盘 2026-10-03-question-focus-ring）', async ({
  page,
}) => {
  await gotoHome(page);
  await page.getByRole('textbox').fill('要不要养一只猫？');
  // 键盘模态：程序移焦会被浏览器判定为 :focus-visible
  await page.getByRole('textbox').press('Enter');
  await waitState(page, 'open');
  const heading = page.locator('[data-focus-heading]');
  await expect(heading).toBeFocused();
  expect(await heading.evaluate((el) => el.matches(':focus-visible'))).toBe(true);
  expect(await heading.evaluate((el) => getComputedStyle(el).outlineStyle)).toBe('none');
});

test('访客态：清空本机记录后访问 /a/:id，主按钮为「我也问问春风」', async ({ page, browser }) => {
  await gotoHome(page);
  await ask(page, '要不要学一门新语言？');
  const url = page.url();

  const ctx = await browser.newContext();
  const visitor = await ctx.newPage();
  await visitor.goto(url);
  await waitState(visitor, 'open');
  await expect(visitor.locator('[data-book-state]')).toHaveAttribute('data-owner', 'false');
  await expect(visitor.getByRole('button', { name: '我也问问春风' })).toBeVisible();
  await expect(visitor.getByRole('button', { name: '再翻一次' })).toHaveCount(0);
  await expect(visitor.getByRole('button', { name: '分享' })).toBeVisible();

  await visitor.getByRole('button', { name: '我也问问春风' }).click();
  await waitState(visitor, 'closed');
  await expect(visitor).toHaveURL(/\/$/);
  expect(await bookState(visitor)).toBe('closed');
  await ctx.close();
});

test('答案页 SSR：HTML 已包含提问与四个选项的标题', async ({ page, request }) => {
  await gotoHome(page);
  await ask(page, '要不要把爱好变成工作？');
  const id = readingIdFromUrl(page.url());
  const api = await request.get(`/api/readings/${id}`);
  expect(api.ok()).toBe(true);
  const { reading } = (await api.json()) as { reading: { question: string; options: { title: string }[] } };

  const res = await request.get(`/a/${id}`);
  expect(res.status()).toBe(200);
  const html = await res.text();
  expect(html).toContain(reading.question);
  expect(reading.options).toHaveLength(4);
  for (const o of reading.options) expect(html).toContain(o.title);
  expect(html).toContain('<meta name="robots" content="noindex, nofollow"');
  // og:image 是静态印章（D36），不再指向分享图
  expect(html).toMatch(/og:image" content="[^"]*\/seal\.png"/);
  expect(html).toContain('og:image:width" content="512"');
});

test('404：/a/notexist 显示「这一页已随风而去」，可回到封面', async ({ page }) => {
  for (const path of ['/a/notexist', '/a/AAAAAAAAAAAA']) {
    const res = await page.goto(path);
    expect(res?.status()).toBe(404);
    await expect(page.getByText('这一页已随风而去').first()).toBeVisible();
  }
  await expect(stage(page)).toHaveAttribute('data-ready', 'true');
  await page.getByRole('button', { name: '问问春风' }).click();
  await waitState(page, 'closed');
  await expect(page).toHaveURL(/\/$/);
});

test('选项说明：选项与说明共用一圈外框，下边框随说明下移（11 §4.2，D38）', async ({ page }) => {
  await gotoHome(page);
  await ask(page, '要不要换个城市生活？');
  const option = page.getByRole('button', { name: /^A，/ });
  const measure = () =>
    option.evaluate((btn) => {
      const item = btn.closest('li') as HTMLElement;
      const frame = item.querySelector('[data-frame-bottom]') as HTMLElement;
      const panel = document.getElementById(btn.getAttribute('aria-controls') ?? '') as HTMLElement;
      const body = panel.querySelector('[data-panel-body]') as HTMLElement;
      const cs = (el: Element, pseudo?: string) => getComputedStyle(el, pseudo);
      return {
        itemBorder: cs(item).borderBottomWidth,
        itemBottom: item.getBoundingClientRect().bottom,
        frameBorder: cs(frame).borderBottomWidth,
        frameBottom: frame.getBoundingClientRect().bottom,
        btnBorder: cs(btn).borderBottomWidth,
        btnBottom: btn.getBoundingClientRect().bottom,
        panelBottom: panel.getBoundingClientRect().bottom,
        bodyBorder: cs(body).borderBottomWidth,
        bodyBg: cs(body).backgroundColor,
        btnBg: cs(btn).backgroundColor,
        divider: cs(body, '::before').borderTopStyle,
        dividerOpacity: Number(cs(body, '::before').opacity),
      };
    });

  // 收起：外框（下半截）紧贴选项，条目、按钮与说明都不画自己的边框
  const closed = await measure();
  expect(closed.itemBorder).toBe('0px');
  expect(closed.frameBorder).toBe('1px');
  expect(closed.btnBorder).toBe('0px');
  expect(closed.bodyBorder).toBe('0px');
  expect(Math.abs(closed.frameBottom - closed.itemBottom)).toBeLessThan(0.5);
  expect(Math.abs(closed.itemBottom - closed.btnBottom - 1)).toBeLessThan(1.5);
  expect(closed.dividerOpacity).toBe(0);

  // 展开：同一圈外框的下边框移到说明下方；分隔为淡色虚线；说明底色与选项不同
  await option.click();
  await expect(option).toHaveAttribute('aria-expanded', 'true');
  await expect.poll(async () => (await measure()).dividerOpacity).toBeCloseTo(0.6);
  // 等滑动结束：下半截外框回到条目底边
  await expect
    .poll(async () => {
      const m = await measure();
      return Math.abs(m.frameBottom - m.itemBottom);
    })
    .toBeLessThan(0.5);
  const open = await measure();
  expect(open.frameBottom - closed.frameBottom).toBeGreaterThan(20);
  expect(Math.abs(open.itemBottom - open.panelBottom - 1)).toBeLessThan(1.5);
  expect(open.divider).toBe('dashed');
  expect(open.bodyBg).not.toBe(open.btnBg);

  // 收起后回到原样
  await option.click();
  await expect(option).toHaveAttribute('aria-expanded', 'false');
  await expect.poll(async () => (await measure()).frameBottom).toBeCloseTo(closed.frameBottom, 0);
  await expect(page.getByRole('region', { name: /说明/ })).toHaveCount(0);
});

test('选项说明：展开与收起只动画 transform 与 opacity，布局一次到位（11 §4.3，AGENTS.md §6.4）', async ({
  page,
}) => {
  await gotoHome(page);
  await ask(page, '要不要换个城市生活？');
  const option = page.getByRole('button', { name: /^B，/ });
  for (const expanded of ['true', 'false']) {
    // 点按后的同一任务里采样：正在运行的动画与条目高度
    const sample = await option.evaluate(async (btn) => {
      const item = btn.closest('li') as HTMLElement;
      (btn as HTMLElement).click();
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      const props = new Set<string>();
      for (const a of document.getAnimations()) {
        if (a.playState !== 'running' || !(a.effect instanceof KeyframeEffect)) continue;
        if (!item.closest('[data-scroll]')?.contains(a.effect.target as Node)) continue;
        for (const k of a.effect.getKeyframes())
          for (const key of Object.keys(k))
            if (!['offset', 'easing', 'composite', 'computedOffset'].includes(key)) props.add(key);
      }
      const h0 = item.getBoundingClientRect().height;
      await new Promise((r) => setTimeout(r, 120));
      const h1 = item.getBoundingClientRect().height;
      return { props: [...props], h0, h1 };
    });
    await expect(option).toHaveAttribute('aria-expanded', expanded);
    expect(sample.props.length).toBeGreaterThan(0);
    for (const prop of sample.props) expect(['transform', 'opacity']).toContain(prop);
    expect(sample.h1).toBe(sample.h0);
  }
});
