import { expect, test } from '@playwright/test';
import { gotoHome, waitState } from './helpers';

// 收尾交接（07 §4.1「显现」）：从落页到显现结束，提问页（双页为左页、单页为本页）每一帧都要被纸完整盖住，
// 不能透出下面近黑的页块（复盘 2026-10-05-left-page-gray-flash）。
//
// 逐帧读取各层的不透明度，按自上而下的叠放估算纸面覆盖率：
//   画布（WebGL / CSS 引擎落页后铺满空白纸；减少动态效果引擎只有徽记，不计）
//   → DOM 纸页 → 封面背面（双页时打开的封面板落在左页上）→ 页块（近黑）

interface Frame {
  phase: string;
  coverage: number;
}

for (const flip of ['webgl', 'css', 'reduced'] as const) {
  test(`?flip=${flip}：收尾到显现，提问页每一帧都被纸盖住`, async ({ page }) => {
    await gotoHome(page, `?flip=${flip}`);
    await page.evaluate(() => {
      const w = window as unknown as { __handoff: Frame[] };
      w.__handoff = [];
      const stage = document.querySelector('[data-book-state]') as HTMLElement;
      /** 元素的实际不透明度（连同祖先）；visibility: hidden 记为 0 */
      const alpha = (el: Element | null): number => {
        if (!el || getComputedStyle(el).visibility === 'hidden') return 0;
        let o = 1;
        for (let e: Element | null = el; e; e = e.parentElement) o *= Number(getComputedStyle(e).opacity);
        return o;
      };
      const step = () => {
        const phase = stage.dataset.bookState ?? '';
        if (phase === 'settling' || phase === 'revealing') {
          const spread = stage.dataset.bookMode === 'spread';
          const root = document.querySelector<HTMLElement>('[data-testid="flip-layer"] [data-flip-engine]');
          const canvas = root && root.dataset.flipEngine !== 'reduced' ? alpha(root) : 0;
          const paper = alpha(
            document.querySelector(`[data-testid="page-base-${spread ? 'left' : 'right'}"]`),
          );
          const board = spread ? alpha(document.querySelector('[class*="board"]')) : 0;
          const coverage = canvas + (1 - canvas) * (paper + (1 - paper) * board);
          w.__handoff.push({ phase, coverage });
        }
        if (phase !== 'open') requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
    await page.getByRole('textbox').fill('明天吃什么');
    await page.getByRole('button', { name: '翻开属于你的那页' }).click();
    await waitState(page, 'open');

    const frames = await page.evaluate(() => (window as unknown as { __handoff: Frame[] }).__handoff);
    const revealing = frames.filter((f) => f.phase === 'revealing');
    expect(revealing.length, '显现阶段的采样帧数').toBeGreaterThan(5);
    const worst = Math.min(...frames.map((f) => f.coverage));
    // 修复前双页最低约 0.4（画布 0.10 × 纸页 0.33）
    expect(worst, '提问页的最低纸面覆盖率').toBeGreaterThanOrEqual(0.99);
  });
}
