import { BookApp } from '@/components/book/BookApp';
import { zh } from '@/copy/zh';

// 未知地址：与 /a/:id 不存在时相同（11 §7）
export default function NotFound() {
  return (
    <>
      <title>{`${zh.meta.title} · ${zh.notFound.title}`}</title>
      <BookApp initial={{ kind: 'notFound' }} />
    </>
  );
}
