import { notFound } from 'next/navigation';
import { FlipHarness } from './FlipHarness';

/** 翻页引擎开发台（仅开发环境）：/dev/flip?flip=webgl|css|reduced&debug=flip */
export default function DevFlipPage() {
  if (process.env.NODE_ENV === 'production') notFound();
  return <FlipHarness />;
}
