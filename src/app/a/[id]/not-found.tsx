import { BookApp } from '@/components/book/BookApp';
import { zh } from '@/copy/zh';

// /a/:id 不存在（11 §7）：书打开在「这一页已随风而去」，纸页上「问问春风」
export default function ReadingNotFound() {
  return (
    <>
      <title>{`${zh.meta.title} · ${zh.notFound.title}`}</title>
      <BookApp initial={{ kind: 'notFound' }} />
    </>
  );
}
