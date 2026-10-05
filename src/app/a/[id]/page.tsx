import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { BookApp } from '@/components/book/BookApp';
import { zh } from '@/copy/zh';
import { splitGraphemes } from '@/lib/shared/question';
import { requestBaseUrl } from '@/server/http/origin';
import { isVisionEnabled } from '@/server/image/vision';
import { getPublicReading } from '@/server/reading/public';
import { SEAL_SIZE } from '@/server/share/seal';

// 答案页（04 §4、07 §1）：服务端直接读库渲染最终状态（HTML 已含提问与选项），挂载后按本机记录区分主人 / 访客。
// 不存在或 id 非法 → notFound()；读库异常 → error.tsx（05 §7）。

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** og:image 的静态印章（public/seal.png，由 pnpm build:seal 生成；12 §2、D36） */
const SEAL_PATH = '/seal.png';

export async function generateMetadata({ params }: PageProps<'/a/[id]'>): Promise<Metadata> {
  const { id } = await params;
  const robots = { index: false, follow: false };
  let reading: ReturnType<typeof getPublicReading> = null;
  try {
    reading = getPublicReading(id);
  } catch {
    reading = null;
  }
  if (!reading) return { title: zh.meta.title, robots };
  const head = splitGraphemes(reading.question).slice(0, 24).join('');
  // og:image 是「春风」印章，不再指向分享图（D36）：爬虫抓链接卡片时不会触发分享图渲染，图片里也没有域名。
  // 它用当前访问域名拼绝对地址（爬虫按链接域名再来抓这张静态图）；Host 缺失或非法时不输出（D45）。
  const baseUrl = requestBaseUrl(await headers());
  return {
    title: `${zh.meta.title} · ${head}`,
    description: zh.meta.description,
    robots,
    openGraph: {
      title: `${zh.meta.title} · ${head}`,
      description: zh.meta.description,
      ...(baseUrl && { images: [{ url: `${baseUrl}${SEAL_PATH}`, width: SEAL_SIZE, height: SEAL_SIZE }] }),
    },
  };
}

export default async function ReadingPage({ params }: PageProps<'/a/[id]'>) {
  const { id } = await params;
  const reading = getPublicReading(id);
  if (!reading) notFound();
  // visionEnabled：主人「换个问题」合书后会回到封面（15 §4）
  return <BookApp initial={{ kind: 'open', reading }} visionEnabled={isVisionEnabled()} />;
}
