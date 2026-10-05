// 等待可视视口稳定（08 §4 第 4 步）：textarea 失焦后移动端键盘收起，visualViewport 会连续 resize。
// 静默 quietMs 或最多 maxMs 后 resolve；不支持 visualViewport 时等一帧。

export function waitViewportSettled(quietMs = 150, maxMs = 350): Promise<void> {
  return new Promise((resolve) => {
    const vv = typeof window === 'undefined' ? undefined : window.visualViewport;
    if (!vv) {
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => resolve());
      else resolve();
      return;
    }
    let quiet: ReturnType<typeof setTimeout>;
    const done = () => {
      clearTimeout(quiet);
      clearTimeout(cap);
      vv.removeEventListener('resize', onResize);
      resolve();
    };
    const onResize = () => {
      clearTimeout(quiet);
      quiet = setTimeout(done, quietMs);
    };
    const cap = setTimeout(done, maxMs);
    quiet = setTimeout(done, quietMs);
    vv.addEventListener('resize', onResize);
  });
}
