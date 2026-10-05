// 前后端共享的领域模型（01 §6）

export type ReadingStatus = 'ok' | 'unclear' | 'sensitive' | 'refused';
export type NoticeStatus = Exclude<ReadingStatus, 'ok'>;
export type OptionLetter = 'A' | 'B' | 'C' | 'D';

export const OPTION_LETTERS: readonly OptionLetter[] = ['A', 'B', 'C', 'D'];

export interface ReadingOption {
  letter: OptionLetter; // 按最终概率降序分配
  title: string;
  desc: string;
  prob: number; // 0–1，四项之和为 1
  pct: number; // 整数百分比，四项之和恰为 100
}

/** 带图提问的图片（15 §7.3）。图片本身经 /api/readings/:id/image 读取，imageId 不公开 */
export interface ReadingImage {
  width: number; // full 规格的尺寸：图片加载前按比例占位，避免布局跳动
  height: number;
  alt: string; // LLM 给出的替代文本；为空时前端用静态文案
}

export interface Reading {
  id: string;
  question: string;
  createdAt: string; // ISO 8601（UTC）
  tz: string;
  options: ReadingOption[];
  pageNo: number;
  regenOf?: string;
  image?: ReadingImage;
}

/** 求助资源：热线电话（phone），或一个外部链接（url，整行文字即链接） */
export type HelpResource =
  | { name: string; phone: string; note?: string }
  | { name: string; url: string; note?: string };

export type CreateReadingResponse =
  | { status: 'ok'; reading: Reading }
  | { status: 'unclear' | 'refused'; message: string }
  | { status: 'sensitive'; message: string; resources: HelpResource[] };

export type ErrorCode =
  | 'BAD_REQUEST'
  | 'PAYLOAD_TOO_LARGE'
  | 'FORBIDDEN_ORIGIN'
  | 'NOT_FOUND'
  | 'RATE_LIMITED'
  | 'BUSY'
  | 'LLM_UNAVAILABLE'
  | 'LLM_BAD_OUTPUT'
  | 'JEV_UNAVAILABLE'
  | 'UPSTREAM_TIMEOUT'
  | 'SERVICE_MISCONFIGURED'
  | 'UNSUPPORTED_MEDIA'
  | 'IMAGE_UNREADABLE'
  | 'IMAGE_NOT_FOUND'
  | 'VISION_DISABLED'
  | 'INTERNAL';

export interface ApiErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    retryable: boolean;
    retryAfterMs?: number;
    requestId?: string;
  };
}
