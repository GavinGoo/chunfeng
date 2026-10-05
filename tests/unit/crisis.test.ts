import { describe, expect, it } from 'vitest';
import { checkCrisis } from '@/server/safety/crisis';
import { HELP_RESOURCES, helpResources } from '@/server/safety/resources';

describe('checkCrisis（02 §9）', () => {
  it.each([
    '我真的不想活了',
    '有时候想自杀',
    '想轻生怎么办',
    '感觉活不下去了',
    '想结束自己的生命',
    '割腕会不会很疼',
    '要不要去跳楼',
    '我想自 杀', // 拆写
    '覺得想自殺', // 繁体
    'I want to kill myself',
    'thinking about suicide lately',
    'Should I end my life?',
    'I have suicidal thoughts',
  ])('命中：%s', (q) => {
    expect(checkCrisis(q).hit).toBe(true);
  });

  it.each([
    '要不要换工作？',
    '双十一跳楼价的手机值得买吗',
    '商场跳楼大甩卖要不要去',
    '这种自杀式的投资策略靠谱吗',
    '周末看《自杀小队》还是《沙丘》？',
    'Should I watch Suicide Squad tonight?',
    '工作累死了要不要请假',
    '笑死，要不要把这个段子发朋友圈',
    '想死你了，要不要周末去看你',
    'This deadline is killing me, should I ask for more time?',
  ])('不命中（易误判）：%s', (q) => {
    expect(checkCrisis(q).hit).toBe(false);
  });

  it('求助资源为静态配置，返回副本', () => {
    const r = helpResources();
    expect(r.map((x) => ('phone' in x ? x.phone : x.url))).toContain('12356');
    r[0]!.name = 'x';
    expect(HELP_RESOURCES[0]!.name).toBe('全国统一心理援助热线');
  });
});
