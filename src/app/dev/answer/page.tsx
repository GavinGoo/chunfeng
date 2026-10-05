// 答案页开发台（仅开发环境）：/dev/answer?sample=short&revealed=1&expand=A,B&panel=0

import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { AnswerHarness } from './AnswerHarness';

export const metadata: Metadata = { title: '春风 · 答案页开发台', robots: { index: false } };

export default function DevAnswerPage() {
  if (process.env.NODE_ENV === 'production') notFound();
  return <AnswerHarness />;
}
