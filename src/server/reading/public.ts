import { isReadingId } from '@/lib/shared/ids';
import type { Reading } from '@/lib/shared/types';
import { getRepository } from './repository';

// 答案页 SSR 的数据访问（04 §4）：`src/app/a/[id]/page.tsx` 直接调用，不经 HTTP。
// 返回 null 时页面应调用 notFound()；数据库异常直接抛出，由 error.tsx 兜底（05 §7）。

export function getPublicReading(id: string): Reading | null {
  if (!isReadingId(id)) return null;
  return getRepository().getPublicReading(id);
}
