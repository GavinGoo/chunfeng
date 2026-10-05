// 分享弹层的环境识别（12 §4）。纯函数部分便于单元测试。

export type ShareEnvKind = 'wechat' | 'mobileShare' | 'mobile' | 'desktop';

export interface ShareEnvInput {
  userAgent: string;
  /** navigator.canShare?.({ files }) 的结果 */
  canShareFiles: boolean;
  /** (pointer: fine) 且可悬停 */
  finePointer: boolean;
}

export function classifyShareEnv({ userAgent, canShareFiles, finePointer }: ShareEnvInput): ShareEnvKind {
  if (/MicroMessenger/i.test(userAgent)) return 'wechat';
  const mobileUa = /Android|iPhone|iPad|iPod|Mobile|HarmonyOS/i.test(userAgent);
  if (finePointer && !mobileUa) return 'desktop';
  return canShareFiles ? 'mobileShare' : 'mobile';
}

/** 浏览器中探测（仅客户端调用） */
export function detectShareEnv(): ShareEnvKind {
  const nav = typeof navigator === 'undefined' ? undefined : navigator;
  let canShareFiles = false;
  try {
    const probe = new File([new Uint8Array(1)], 'probe.png', { type: 'image/png' });
    canShareFiles = Boolean(nav?.canShare?.({ files: [probe] }));
  } catch {
    canShareFiles = false;
  }
  const finePointer =
    typeof window !== 'undefined' &&
    window.matchMedia?.('(hover: hover) and (pointer: fine)').matches === true;
  return classifyShareEnv({ userAgent: nav?.userAgent ?? '', canShareFiles, finePointer });
}

/** 分享图 URL：一篇答案一张图（D35），没有版本参数；`r` 只在「重试」时追加，用来绕过浏览器缓存 */
export function shareImageUrl(readingId: string, retry: number): string {
  const base = `/api/readings/${encodeURIComponent(readingId)}/share-image`;
  return retry > 0 ? `${base}?r=${retry}` : base;
}
