// 春风 · 全部界面文案（单一来源，06 §8）
//
// - 组件中不硬编码中文，一律从这里取。
// - 带变量的文案写成模板字符串（`{name}` 占位），由下方的格式化函数填充；
//   这样 `collectStaticStrings()` 能拿到每一个会出现在界面上的汉字，用于生成 UI 子集字体（06 §3.2）。
// - 语气：温和、笃定、略带诗意，但先求清楚；不用感叹号连用、网络流行语与颜文字。

import { splitGraphemes } from '@/lib/shared/question';
import type { ErrorCode } from '@/lib/shared/types';

export const zh = {
  meta: {
    title: '春风',
    description: '遇事不决，可问春风',
    /** 07 §6：打开态的页面标题 */
    titleWithQuestion: '春风 · {question}',
  },

  /** 页角 GitHub 链接（06 §7.1）：只有图标，文案用作无障碍名称 */
  repoLink: {
    label: '在 GitHub 上查看源代码',
  },

  cover: {
    title: '春风',
    subtitle: '遇事不决，可问春风',
    /** 封面整体的无障碍名称 */
    label: '春风之书的封面',
    input: {
      label: '写下你的问题',
      /** 为空且用户未点进输入框时，以打字机效果逐句轮播（08 §2），第一条为默认 */
      placeholders: [
        '写下你此刻的困惑……',
        '要不要换一份工作？',
        '今晚该不该向 TA 表白？',
        '周末去海边，还是进山？',
      ],
      /** 计数：168 / 200 */
      counter: '{count} / {max}',
      counterLabel: '已写 {count} 字，最多 {max} 字',
      pasteTruncated: '已截取前 {max} 字',
      /** 05 §2：BAD_REQUEST / PAYLOAD_TOO_LARGE 回到封面后，在输入框下提示 */
      badRequest: '这句话春风没能读懂，换个写法再试试。',
    },
    openButton: '翻开属于你的那页',
    /** 点击禁用态的引导（08 §3），也用于长度不足 2 字时 */
    emptyGuide: '先写下你的问题吧',
    /** 图片提问（15 §10.10）：LLM_VISION=true 时才出现 */
    image: {
      attach: '附上一张图片',
      preview: '预览图片',
      retry: '重试上传图片',
      remove: '删除图片',
      /** 失败时的提示行：{reason} 为下方 reasons 之一（去掉句末标点） */
      failed: '{reason}，轻触缩略图重试',
      dropHere: '松手，把图片夹进书里',
      onlyOne: '一次只能附一张图',
      /** 只附了图、没有写字（Q10） */
      needText: '写一句你想问的，春风才知道从何看起',
      notReady: '图片还没附上：轻触缩略图重试，或删除后再翻开',
      reasons: {
        unsupported: '暂不支持这种图片，换一张 JPG 或 PNG 试试',
        tooLarge: '图片太大了，换一张小一些的吧',
        unreadable: '这张图片打不开，换一张试试',
        rateLimited: '附图有些频繁，{seconds} 秒后再试',
        network: '图片没能送到，再试一次吧',
      },
      /** 提问结果为 IMAGE_NOT_FOUND / VISION_DISABLED 时合书并提示（15 §10.8） */
      expired: '图片已过期，请重新附上',
      disabled: '春风暂时看不了图片，只写文字也可以',
    },
  },

  flipping: {
    /** 翻页中的提示文案（07 §4），按已翻时长切换 */
    hints: [
      { atMs: 0, text: '春风正在翻书……' },
      { atMs: 3000, text: '风过书页，答案渐近……' },
      { atMs: 8000, text: '在字里行间寻找属于你的那一页……' },
      { atMs: 20000, text: '书页有些多，快找到了……' },
    ],
    /** 带图提问时第一句（0–3 s）改为此句（15 §10.9） */
    withImageFirst: '春风正在端详这张图……',
    close: '合上',
  },

  actions: {
    regenerate: '再翻一次',
    share: '分享',
    changeQuestion: '换个问题',
    askToo: '我也问问春风',
    close: '合上',
    retry: '再试一次',
    /** unclear 提示页：合书并预填原问题 */
    askAgain: '重新提问',
    /** 404 页 */
    ask: '问问春风',
    refresh: '刷新',
  },

  answer: {
    /** 横屏右页顶部小标题（11 §2.2） */
    heading: '风吟',
    firstHint: '轻触选项，看看春风怎么说',
    aiLabel: '内容由 AI 生成，仅供参考',
    pageNo: '第 {n} 页',
    /** 提问前后的直角引号 */
    questionQuote: '「{question}」',
    pctZero: '<1%',
    pct: '{pct}%',
    /** 11 §4.1：屏幕阅读器读作「B，拿着邀约谈一次加薪，25%，已收起」 */
    optionLabel: '{letter}，{title}，{pct}，{state}',
    expanded: '已展开',
    collapsed: '已收起',
    descRegion: '{letter} 的说明',
    /** 11 §1：页眉时间与农历之间的间隔号 */
    dateSeparator: ' · ',
    /** 11 §2.3：低矮横屏下提问限 3 行，点击展开全文 */
    expandQuestion: '展开完整的问题',
    collapseQuestion: '收起问题',
    /** 带图答案的相片（15 §11） */
    photoLabel: '放大查看图片：{alt}',
    photoAltFallback: '提问者附上的图片',
    /** 提示页与错误页：没有落库的答案，只写一行小字 */
    photoNote: '附图一张',
  },

  /** 查看大图（15 §11.4） */
  viewer: {
    label: '查看图片',
    close: '关闭',
  },

  notice: {
    unclear: {
      title: '春风没有听清',
      fallback: '换个说法，再问一次吧。',
    },
    sensitive: {
      title: '先照顾好自己',
      fallback: '你愿意把这些写下来，已经很勇敢了。此刻比起选择，你更值得有人陪你聊一聊。',
      resourcesTitle: '可以找他们聊聊',
    },
    refused: {
      title: '这一页，春风不便翻开',
      fallback: '这个问题春风不便作答。换一个问题，春风仍在这里。',
    },
  },

  error: {
    /** 可重试的错误（11 §7） */
    retryable: {
      title: '风停了片刻',
      body: '书页没能翻到你那一页。',
    },
    /** 按错误码补充的一句；未列出的错误码不补充 */
    extra: {
      RATE_LIMITED: '春风有些应接不暇，{seconds} 秒后再试。',
      BUSY: '此刻来问春风的人有些多。',
      LLM_UNAVAILABLE: '春风一时没能想好，再试一次吧。',
      LLM_BAD_OUTPUT: '春风写下的字迹有些潦草，再试一次吧。',
      JEV_UNAVAILABLE: '四条路已经写好，只差最后的斟酌。',
      UPSTREAM_TIMEOUT: '这一次翻得太久了。',
      INTERNAL: '书页被风吹乱了。',
    } satisfies Partial<Record<ErrorCode, string>>,
    /** 前端网络错误（请求没有到达服务端） */
    network: '网络有些不稳。',
    /** RATE_LIMITED：倒计时归零前「再试一次」置灰 */
    countdown: '{seconds} 秒后可以再试',
    /** RATE_LIMITED 倒计时归零后，替换补充句 */
    rateLimitReady: '春风缓过来了，可以再试一次。',
    misconfigured: {
      title: '春风暂时无法作答',
      body: '请稍后再来。',
    },
    offline: {
      title: '你似乎离线了',
      body: '连上网络后，再翻一次。',
    },
    /** 05 §7：`/a/[id]` 读库失败时的 error.tsx */
    server: {
      title: '书页一时翻不开',
      body: '稍等片刻，再刷新看看。',
    },
  },

  notFound: {
    title: '这一页已随风而去',
    body: '也许它从未被写下，也许已被风吹散。',
  },

  share: {
    /** 弹层标题（视觉隐藏，供屏幕阅读器） */
    dialogLabel: '分享这一页',
    wechatHint: '长按图片，保存或发送给朋友',
    longPressHint: '长按图片，保存或分享',
    shareImage: '分享图片',
    shareTitle: '春风',
    download: '下载图片',
    downloadName: 'chunfeng-{id}.png',
    copyLink: '复制链接',
    copied: '链接已复制',
    copyFailed: '没能复制，请长按链接手动复制',
    imageFailed: '图片没能生成',
    imageRetry: '重试',
    imageLoading: '分享图正在生成',
    imageAlt: '春风分享图：{question}',
    close: '关闭',
    /** 分享图下方二维码左侧的文字（R12） */
    slogan: '遇事不决，可问春风',
    scanHint: '长按扫码查看答案详情',
    /** 复制失败时展示可选中的链接（05 §7） */
    linkLabel: '答案链接',
    /** 图片加载完成（读屏播报） */
    imageReady: '分享图已生成',
    /** 带图答案：分享弹层中图片下方的提示（15 §12） */
    containsPhoto: '分享图中含有你附上的图片',
    /** 分享图上的文字（12 §2） */
    image: {
      seal: '春风',
      asked: '所问',
      /** 带图答案读图失败时，「所问」行右侧的兜底标注（15 §12） */
      photoFallback: '附图一张 · 扫码查看',
      /** 提问全部由 emoji 组成、清洗后为空时的占位 */
      emptyQuestion: '……',
    },
  },

  /** 屏幕阅读器播报（07 §8） */
  live: {
    flipping: '春风正在翻书',
    revealed: '答案已翻开，共四条路',
    error: '出了点问题：{message}',
    notice: '春风的回话：{title}',
    closed: '书已合上，可以写下新的问题',
    copied: '链接已复制',
    /** 附图（15 §10.3） */
    imageUploading: '正在附上图片',
    imageReady: '图片已附上',
    imageFailed: '图片没能附上：{reason}',
    imageRemoved: '图片已删除',
  },

  a11y: {
    /** 答案页提问标题前的视觉隐藏前缀 */
    questionPrefix: '你的问题：',
    optionsLabel: '春风给出的四条路',
  },

  /** 背景星盘（10 §2）：装饰性文字，aria-hidden，只为让子集字体收录这些字 */
  ambient: {
    /** 二十八宿，自角宿起按东、北、西、南七宿一组逆时针排列 */
    mansions: [
      ['角', '亢', '氐', '房', '心', '尾', '箕'],
      ['斗', '牛', '女', '虚', '危', '室', '壁'],
      ['奎', '娄', '胃', '昴', '毕', '觜', '参'],
      ['井', '鬼', '柳', '星', '张', '翼', '轸'],
    ],
    /** 四象，与上面四组一一对应 */
    symbols: ['东方青龙', '北方玄武', '西方白虎', '南方朱雀'],
  },
} as const;

export type Copy = typeof zh;

// ---------- 格式化 ----------

type Vars = Record<string, string | number>;

/** 用 vars 填充 `{name}` 占位；缺失的变量原样保留，便于发现遗漏 */
export function fill(template: string, vars: Vars): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) => {
    const v = vars[key];
    return v === undefined ? whole : String(v);
  });
}

export function formatPageTitle(question?: string): string {
  if (!question) return zh.meta.title;
  const head = splitGraphemes(question).slice(0, 12).join('');
  return fill(zh.meta.titleWithQuestion, { question: head });
}

export function formatCounter(count: number, max: number): string {
  return fill(zh.cover.input.counter, { count, max });
}

export function formatCounterLabel(count: number, max: number): string {
  return fill(zh.cover.input.counterLabel, { count, max });
}

export function formatPasteTruncated(max: number): string {
  return fill(zh.cover.input.pasteTruncated, { max });
}

export function formatPageNo(n: number): string {
  return fill(zh.answer.pageNo, { n });
}

export function formatQuestionQuote(question: string): string {
  return fill(zh.answer.questionQuote, { question });
}

/** pct 为整数百分比；0 显示「<1%」（11 §4.2） */
export function formatPct(pct: number): string {
  return pct <= 0 ? zh.answer.pctZero : fill(zh.answer.pct, { pct });
}

export function formatOptionLabel(letter: string, title: string, pct: number, expanded: boolean): string {
  return fill(zh.answer.optionLabel, {
    letter,
    title,
    pct: formatPct(pct),
    state: expanded ? zh.answer.expanded : zh.answer.collapsed,
  });
}

export function formatDescRegion(letter: string): string {
  return fill(zh.answer.descRegion, { letter });
}

/** 翻页中按已翻时长选择提示文案；带图提问时第一句改为「端详这张图」（15 §10.9） */
export function flippingHintAt(elapsedMs: number, opts: { withImage?: boolean } = {}): string {
  let text: string = zh.flipping.hints[0].text;
  for (const h of zh.flipping.hints) {
    if (elapsedMs >= h.atMs) text = h.text;
  }
  if (opts.withImage && text === zh.flipping.hints[0].text) return zh.flipping.withImageFirst;
  return text;
}

export type ImageFailReason = keyof typeof zh.cover.image.reasons;

/** 附图失败的原因（完整句）；rateLimited 需要秒数 */
export function formatImageReason(reason: ImageFailReason, retryAfterMs?: number): string {
  const seconds = Math.max(1, Math.ceil((retryAfterMs ?? 0) / 1000));
  return fill(zh.cover.image.reasons[reason], { seconds });
}

/** 附图失败时的提示行：「{原因}，轻触缩略图重试」 */
export function formatImageFailedHint(reason: ImageFailReason, retryAfterMs?: number): string {
  const r = formatImageReason(reason, retryAfterMs).replace(/[。！!，,]+$/u, '');
  return fill(zh.cover.image.failed, { reason: r });
}

export function formatLiveImageFailed(reason: ImageFailReason, retryAfterMs?: number): string {
  return fill(zh.live.imageFailed, { reason: formatImageReason(reason, retryAfterMs) });
}

/** 答案页相片的无障碍名称；alt 为空时用静态文案 */
export function formatPhotoLabel(alt: string): string {
  return fill(zh.answer.photoLabel, { alt: alt.trim() || zh.answer.photoAltFallback });
}

/** 可重试错误的补充句；RATE_LIMITED 需要秒数 */
export function formatErrorExtra(code: ErrorCode, retryAfterMs?: number): string | undefined {
  const extra: Partial<Record<ErrorCode, string>> = zh.error.extra;
  const template = extra[code];
  if (!template) return undefined;
  const seconds = Math.max(1, Math.ceil((retryAfterMs ?? 0) / 1000));
  return fill(template, { seconds });
}

export function formatCountdown(remainingMs: number): string {
  return fill(zh.error.countdown, { seconds: Math.max(0, Math.ceil(remainingMs / 1000)) });
}

export function formatShareAlt(question: string): string {
  return fill(zh.share.imageAlt, { question });
}

export function formatDownloadName(id: string): string {
  return fill(zh.share.downloadName, { id });
}

export function formatLiveError(message: string): string {
  return fill(zh.live.error, { message });
}

export function formatLiveNotice(title: string): string {
  return fill(zh.live.notice, { title });
}

// ---------- 静态文案收集（build-fonts 使用） ----------

/** 深度遍历文案对象，返回其中每一个字符串（含模板，占位符原样保留） */
export function collectStaticStrings(root: unknown = zh): string[] {
  const out: string[] = [];
  const walk = (node: unknown): void => {
    if (typeof node === 'string') {
      out.push(node);
    } else if (Array.isArray(node)) {
      for (const item of node) walk(item);
    } else if (node && typeof node === 'object') {
      for (const value of Object.values(node)) walk(value);
    }
  };
  walk(root);
  return out;
}
