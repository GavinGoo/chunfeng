// /dev/answer 的样例数据（仅开发环境）

import type { PageContentModel } from '@/components/answer';
import type { ReadingOption } from '@/lib/shared/types';

const OPTIONS: ReadingOption[] = [
  {
    letter: 'A',
    title: '先摸清底细，一周后再定',
    desc: '创业公司的邀约往往附带一个「现在就要答复」的暗示，但一周的缓冲几乎总是可以争取的。用这一周去见见未来的直属上级，问清融资进度与现金流能撑多久，再看看期权条款。信息补齐之后，无论去留，你都不会后悔自己仓促。',
    prob: 0.4412,
    pct: 44,
  },
  {
    letter: 'B',
    title: '拿着邀约谈一次加薪',
    desc: '外部邀约是一面照见自身价值的镜子。把它作为筹码，与现在的上级坦诚谈一次；即便最后仍决定离开，这次谈话也会让你更清楚自己在这里的位置。只是要做好准备：一旦开口，关系便不会完全回到从前。',
    prob: 0.2507,
    pct: 25,
  },
  {
    letter: 'C',
    title: '接下创业公司的邀约',
    desc: '三年正是可以承担一些风险的时候。创业公司能让你更快地接触完整的业务，也更快地看见自己的边界。代价是更长的工时与更大的不确定，出发之前，先为自己留出半年的生活费。',
    prob: 0.1981,
    pct: 20,
  },
  {
    letter: 'D',
    title: '留在原公司，主动破局',
    desc: '想走，有时只是因为停滞太久。与其换一个地方，不如先在原地换一种做法：申请一个新项目，或者跨部门轮岗。若半年之后仍然觉得憋闷，那时再走，理由也会更加清楚。',
    prob: 0.11,
    pct: 11,
  },
];

const ZERO_OPTIONS: ReadingOption[] = [
  { ...OPTIONS[0]!, title: '现在就迈出第一步', prob: 0.72, pct: 72 },
  { ...OPTIONS[1]!, title: '按兵不动，再观察一阵', prob: 0.2, pct: 20 },
  { ...OPTIONS[2]!, title: '找信任的人聊一聊', prob: 0.076, pct: 8 },
  { ...OPTIONS[3]!, title: '选择更难的那条路', prob: 0.004, pct: 0 },
];

const LONG_Q =
  '我在一家大公司做了三年后端开发，最近一位前同事拉我去他的创业公司做技术负责人，薪水只涨两成但给期权。家里刚买了房，每月房贷一万二，妻子怀孕五个月，父母也希望我稳定一些。可我总觉得再不出去试试，这辈子可能就没机会了。';

const Q_200 =
  `${'我想知道，在这个人人都说要稳定的年代，一个三十岁的人放弃安稳的工作去追求年少时的梦想，究竟是勇敢还是任性？'.repeat(4)}`.slice(
    0,
    200,
  );

const base = { id: 'dev', createdAt: '2026-09-27T13:40:00Z', tz: 'Asia/Shanghai', pageNo: 237 };

export const SAMPLES: Record<string, { label: string; model: PageContentModel }> = {
  short: {
    label: '答案 · 短提问',
    model: {
      kind: 'answer',
      owner: true,
      reading: { ...base, question: '工作三年了，要不要跳槽去创业公司？', options: OPTIONS },
    },
  },
  long: {
    label: '答案 · 长提问',
    model: { kind: 'answer', owner: true, reading: { ...base, question: LONG_Q, options: OPTIONS } },
  },
  q200: {
    label: '答案 · 200 字',
    model: { kind: 'answer', owner: false, reading: { ...base, question: Q_200, options: OPTIONS } },
  },
  zero: {
    label: '答案 · <1%',
    model: {
      kind: 'answer',
      owner: false,
      reading: { ...base, question: '周末去海边，还是进山？', pageNo: 58, options: ZERO_OPTIONS },
    },
  },
  // 带图（15 §11）：?rid=<答案 id> 时用真实答案的图片，否则图片加载失败，显示占位（也用于检查失败样式）
  photo: {
    label: '带图 · 横图',
    model: {
      kind: 'answer',
      owner: true,
      reading: {
        ...base,
        question: '这两件哪件更适合明天面试？',
        options: OPTIONS,
        image: { width: 1536, height: 1152, alt: '两件外套并排挂着，左边墨绿、右边米色' },
      },
    },
  },
  photoTall: {
    label: '带图 · 竖图',
    model: {
      kind: 'answer',
      owner: false,
      reading: {
        ...base,
        id: 'devPhotoTall',
        question: '菜单上这几道，第一次来点哪个？',
        options: OPTIONS,
        image: { width: 900, height: 1600, alt: '一页手写菜单' },
      },
    },
  },
  photoLong: {
    label: '带图 · 长提问',
    model: {
      kind: 'answer',
      owner: true,
      reading: { ...base, question: LONG_Q, options: OPTIONS, image: { width: 1200, height: 1200, alt: '' } },
    },
  },
  photoNotice: {
    label: '带图 · 提示页',
    model: { kind: 'notice', status: 'refused', message: '', question: '这张图怎么选？', hasImage: true },
  },
  unclear: {
    label: '提示 · 没听清',
    model: { kind: 'notice', status: 'unclear', message: '', question: '嗯嗯嗯那个' },
  },
  sensitive: {
    label: '提示 · 照顾好自己',
    model: {
      kind: 'notice',
      status: 'sensitive',
      message: '',
      question: '我觉得活着好累',
      resources: [
        { name: '全国统一心理援助热线', phone: '12356' },
        { name: '北京心理危机研究与干预中心', phone: '010-82951332' },
        { name: '希望 24 热线', phone: '400-161-9995' },
        { name: '紧急求助', phone: '110 / 120', note: '如有紧急危险，请立即拨打' },
        {
          name: '猫猫很想你，来看看它们吧 🐾',
          url: 'https://space.bilibili.com/11933497/favlist?fid=989271197',
        },
      ],
    },
  },
  refused: {
    label: '提示 · 不便翻开',
    model: { kind: 'notice', status: 'refused', message: '', question: '怎么黑进别人的邮箱' },
  },
  rateLimited: {
    label: '错误 · 限流',
    model: {
      kind: 'error',
      question: '工作三年了，要不要跳槽去创业公司？',
      error: { code: 'RATE_LIMITED', message: '', retryable: true, retryAfterMs: 12_000, status: 429 },
    },
  },
  jev: {
    label: '错误 · JEV',
    model: {
      kind: 'error',
      question: '工作三年了，要不要跳槽去创业公司？',
      error: { code: 'JEV_UNAVAILABLE', message: '', retryable: true, status: 502 },
    },
  },
  network: {
    label: '错误 · 网络',
    model: {
      kind: 'error',
      question: '工作三年了，要不要跳槽去创业公司？',
      error: { code: 'NETWORK', message: '', retryable: true },
    },
  },
  misconfigured: {
    label: '错误 · 无法作答',
    model: {
      kind: 'error',
      question: '工作三年了，要不要跳槽去创业公司？',
      error: { code: 'SERVICE_MISCONFIGURED', message: '', retryable: false, status: 503 },
    },
  },
  offline: {
    label: '错误 · 离线',
    model: {
      kind: 'error',
      question: '工作三年了，要不要跳槽去创业公司？',
      error: { code: 'OFFLINE', message: '', retryable: true },
    },
  },
  notFound: { label: '404', model: { kind: 'notFound' } },
};
