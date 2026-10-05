import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ShareHarness } from './ShareHarness';

export const metadata: Metadata = { title: '春风 · 分享开发台', robots: { index: false } };

/** 分享弹层开发台（仅开发环境）：/dev/share?id=xxxx 直接打开已有答案（加 &photo 显示带图提示），否则用模拟上游新建一条 */
export default function DevSharePage() {
  if (process.env.NODE_ENV === 'production') notFound();
  return <ShareHarness />;
}
