import type { HelpResource } from '@/lib/shared/types';

// 求助资源（11 §7）：由服务端静态下发，绝不使用 LLM 生成的号码。
// 上线前必须人工核实号码与服务时间（AGENTS.md Q8）。

export const HELP_RESOURCES: readonly HelpResource[] = Object.freeze([
  { name: '全国统一心理援助热线', phone: '12356' },
  { name: '北京心理危机研究与干预中心', phone: '010-82951332' },
  { name: '希望 24 热线', phone: '400-161-9995' },
  { name: '紧急求助', phone: '110 / 120', note: '如有紧急危险，请立即拨打' },
  { name: '猫猫很想你，来看看它们吧 🐾', url: 'https://space.bilibili.com/11933497/favlist?fid=989271197' },
]);

export function helpResources(): HelpResource[] {
  return HELP_RESOURCES.map((r) => ({ ...r }));
}
