import { BookApp } from '@/components/book/BookApp';
import { isVisionEnabled } from '@/server/image/vision';

// 首页（07 §1）：合上的书。
// 动态渲染：图片提问的开关（LLM_VISION）要按运行时的值读取，SSR 首屏就决定是否渲染附图入口（15 §4）。

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export default function HomePage() {
  return <BookApp initial={{ kind: 'closed' }} visionEnabled={isVisionEnabled()} />;
}
