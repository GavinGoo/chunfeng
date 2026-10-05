/**
 * 书本几何（07 §3）：纯函数，根据视口与安全区计算书的尺寸、位置与单/双页模式。
 * 所有值均为 CSS px，相对视口左上角。
 */

export type BookMode = 'single' | 'spread';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface BookGeometry {
  mode: BookMode;
  page: { w: number; h: number };
  /** 合上时封面的位置 */
  closed: Rect;
  /** 打开后整本书的位置（single：一页；spread：两页） */
  open: Rect;
  /** 打开态书脊的 x 坐标 */
  spineX: number;
  /** 书外底部操作区 */
  actionBar: Rect;
  /** 页角 GitHub 链接的点按区（06 §7.1）：视口右下角，避开操作区的按钮行 */
  repoLink: Rect;
  /** CSS perspective 与 WebGL 相机距离（两者必须一致） */
  perspective: number;
}

export interface Viewport {
  w: number;
  h: number;
}

export interface SafeArea {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export const PAGE_RATIO = 0.68;
export const ACTION_BAR_H = 96;
export const MAX_PAGE_H = 820;
export const MAX_SINGLE_PAGE_W = 560;
/** 横屏判定阈值：vw / vh ≥ 1.05 → 双页 */
export const SPREAD_ASPECT = 1.05;
/** 相机视场角 30°，即半角 15° */
export const HALF_FOV_RAD = (15 * Math.PI) / 180;
/** 极端小视口下的页高下限，避免出现负值或退化尺寸 */
const MIN_PAGE_H = 120;
/** 低矮视口（手机横放等）：高度低于此值时收紧上下边距与操作区，合上时封面放大（07 §3 实施记录） */
export const LOW_VIEWPORT_H = 480;
export const ACTION_BAR_H_LOW = 64;
/** 低矮视口下合上的书相对打开态页面的最大放大倍数 */
const MAX_CLOSED_SCALE = 1.4;
/** 操作区最小宽度（容纳「再翻一次 · 分享 · 换个问题」） */
const MIN_ACTION_BAR_W = 320;
/** 触控目标下限（--tap-min），操作区按钮行的高度 */
const TAP_MIN = 44;
/** 页角 GitHub 链接的点按区边长 */
export const REPO_LINK_SIZE = 44;
/** 页角链接下移时与按钮行之间的间隙 */
const REPO_LINK_GAP = 4;

const ZERO_SAFE_AREA: SafeArea = { top: 0, bottom: 0, left: 0, right: 0 };

export function perspectiveFor(vh: number): number {
  return vh / 2 / Math.tan(HALF_FOV_RAD);
}

export function computeGeometry(viewport: Viewport, safeArea: SafeArea = ZERO_SAFE_AREA): BookGeometry {
  const vw = Math.max(1, viewport.w);
  const vh = Math.max(1, viewport.h);

  const low = vh < LOW_VIEWPORT_H;
  const top = low ? Math.max(12, safeArea.top + 8) : Math.max(24, safeArea.top + 16);
  const bottom = low ? Math.max(8, safeArea.bottom) : Math.max(16, safeArea.bottom);
  const barH = low ? ACTION_BAR_H_LOW : ACTION_BAR_H;
  const availH = Math.max(MIN_PAGE_H, vh - top - barH - bottom);
  const mode: BookMode = vw / vh >= SPREAD_ASPECT ? 'spread' : 'single';

  // 左右安全区：规则中的 32 / 64 px 边距与安全区取较大者（无安全区时与 07 §3 完全一致）
  const sideL = Math.max(16, safeArea.left);
  const sideR = Math.max(16, safeArea.right);

  const maxH = Math.min(availH, MAX_PAGE_H);
  let pageW: number;
  if (mode === 'single') {
    pageW = Math.min(maxH * PAGE_RATIO, vw - sideL - sideR, MAX_SINGLE_PAGE_W);
  } else {
    // 双页书脊居中，两侧边距对称取较大者
    const side = Math.max(32, safeArea.left, safeArea.right);
    pageW = Math.min(maxH * PAGE_RATIO, (vw - 2 * side) / 2);
  }
  // 取整到整像素，避免 DOM 与 WebGL 的亚像素接缝
  pageW = Math.max(1, Math.floor(pageW));
  const pageH = Math.round(pageW / PAGE_RATIO);

  // 书与操作区作为整体，在 [top, vh − bottom] 内垂直居中
  const blockH = pageH + barH;
  const regionH = vh - top - bottom;
  const y = Math.round(top + Math.max(0, (regionH - blockH) / 2));

  let closed: Rect = { x: Math.round((vw - pageW) / 2), y, w: pageW, h: pageH };
  if (low) {
    // 合上时不需要书外操作区（按钮在封面上）：封面用满可用高度，打开时再随封面翻开缩回页面尺寸
    const maxW = Math.min(pageW * MAX_CLOSED_SCALE, vw - sideL - sideR);
    const cw = Math.max(pageW, Math.floor(Math.min(Math.min(regionH, MAX_PAGE_H) * PAGE_RATIO, maxW)));
    const ch = Math.round(cw / PAGE_RATIO);
    closed = {
      x: Math.round((vw - cw) / 2),
      y: Math.round(top + Math.max(0, (regionH - ch) / 2)),
      w: cw,
      h: ch,
    };
  }

  let open: Rect;
  let spineX: number;
  if (mode === 'single') {
    spineX = Math.round((vw - pageW) / 2);
    open = { x: spineX, y, w: pageW, h: pageH };
  } else {
    spineX = Math.round(vw / 2);
    open = { x: spineX - pageW, y, w: 2 * pageW, h: pageH };
  }

  const barW = Math.min(vw - sideL - sideR, Math.max(open.w, MIN_ACTION_BAR_W));
  const actionBar: Rect = {
    x: Math.round((vw - barW) / 2),
    y: y + pageH,
    w: Math.round(barW),
    h: barH,
  };

  // 页角 GitHub 链接（06 §7.1）：默认贴右下角；窄竖屏的操作区几乎占满宽度，
  // 若点按区与按钮行（44 px 高，在操作区内垂直居中）相交，就下移到按钮行之下，但不进入底部安全区
  const linkR = low ? Math.max(8, safeArea.right + 8) : Math.max(16, safeArea.right + 12);
  const linkB = low ? Math.max(8, safeArea.bottom + 8) : Math.max(16, safeArea.bottom + 12);
  const linkX = vw - linkR - REPO_LINK_SIZE;
  let linkY = vh - linkB - REPO_LINK_SIZE;
  const rowBottom = actionBar.y + (barH + TAP_MIN) / 2;
  if (linkX < actionBar.x + actionBar.w && linkY < rowBottom + REPO_LINK_GAP) {
    linkY = Math.min(rowBottom + REPO_LINK_GAP, vh - safeArea.bottom - REPO_LINK_SIZE);
  }
  const repoLink: Rect = { x: Math.round(linkX), y: Math.round(linkY), w: REPO_LINK_SIZE, h: REPO_LINK_SIZE };

  return {
    mode,
    page: { w: pageW, h: pageH },
    closed,
    open,
    spineX,
    actionBar,
    repoLink,
    perspective: perspectiveFor(vh),
  };
}

/** 两个几何是否在渲染意义上等价（用于 resize 去抖） */
export function sameGeometry(a: BookGeometry, b: BookGeometry): boolean {
  return (
    a.mode === b.mode &&
    a.page.w === b.page.w &&
    a.page.h === b.page.h &&
    a.open.x === b.open.x &&
    a.open.y === b.open.y &&
    a.spineX === b.spineX &&
    a.closed.x === b.closed.x &&
    a.closed.y === b.closed.y &&
    a.closed.w === b.closed.w &&
    Math.abs(a.perspective - b.perspective) < 0.01
  );
}
