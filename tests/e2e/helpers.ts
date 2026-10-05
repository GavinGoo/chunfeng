import { expect, type Page } from '@playwright/test';

// 舞台 E2E 的公共步骤：一律等待 data-book-state，而不是固定时长

export const stage = (page: Page) => page.locator('[data-book-state]');

export async function bookState(page: Page): Promise<string | null> {
  return stage(page).getAttribute('data-book-state');
}

export async function waitState(page: Page, state: string, timeout = 30_000): Promise<void> {
  await expect(stage(page)).toHaveAttribute('data-book-state', state, { timeout });
}

/** 打开首页并等到可交互（水合完成） */
export async function gotoHome(page: Page, query = ''): Promise<void> {
  await page.goto(`/${query}`);
  await expect(stage(page)).toHaveAttribute('data-ready', 'true');
  await waitState(page, 'closed');
}

/** 写下问题并点击「翻开属于你的那页」，等到打开态 */
export async function ask(page: Page, question: string): Promise<void> {
  await page.getByRole('textbox').fill(question);
  await page.getByRole('button', { name: '翻开属于你的那页' }).click();
  await waitState(page, 'open');
}

/** 在页面内记录每个状态首次出现的时刻（performance.now） */
export async function recordStates(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __states: Record<string, number> };
    w.__states = {};
    const el = document.querySelector('[data-book-state]');
    if (!el) return;
    new MutationObserver(() => {
      const s = el.getAttribute('data-book-state') ?? '';
      if (!(s in w.__states)) w.__states[s] = performance.now();
    }).observe(el, { attributes: true, attributeFilter: ['data-book-state'] });
  });
}

export async function states(page: Page): Promise<Record<string, number>> {
  return page.evaluate(() => (window as unknown as { __states: Record<string, number> }).__states);
}

export async function pageText(page: Page): Promise<string> {
  return (await page.getByTestId('page-content').innerText()).replace(/\s+/g, ' ');
}

export const readingIdFromUrl = (url: string): string => {
  const m = /\/a\/([A-Za-z0-9_-]{12})/.exec(url);
  if (!m?.[1]) throw new Error(`not a reading url: ${url}`);
  return m[1];
};
