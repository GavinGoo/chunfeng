// 危机词预检（02 §9）：调用 LLM 之前的第一道防线。
// 只放歧义很小的词（高精度），细微情况交给 LLM 判断。命中后直接返回 sensitive，不调用 LLM 与 JEV。

/** 中文（含繁体）关键词：匹配前会去掉空白与标点，防止「自 杀」之类的拆写绕过 */
const ZH_KEYWORDS = [
  '自杀',
  '自殺',
  '轻生',
  '輕生',
  '不想活了',
  '不想活下去',
  '活不下去',
  '结束自己的生命',
  '結束自己的生命',
  '结束我的生命',
  '結束我的生命',
  '了结自己',
  '了結自己',
  '割腕',
  '跳楼',
  '跳樓',
  '自残',
  '自殘',
  '寻短见',
  '尋短見',
  '自尽',
  '自盡',
] as const;

/** 易误判的固定搭配：先从文本中剔除，再匹配关键词 */
const ZH_BENIGN = [
  '跳楼价',
  '跳樓價',
  '跳楼甩卖',
  '跳楼大甩卖',
  '跳樓大甩賣',
  '跳楼大减价',
  '自杀式',
  '自殺式',
  '自杀小队',
  '自殺小隊',
] as const;

const EN_PATTERNS = [
  /\bsuicid(?:e|al)\b(?!\s+squad)/i,
  /\bkill(?:ing)?\s+my\s*self\b/i,
  /\bend(?:ing)?\s+my\s+(?:own\s+)?life\b/i,
  /\bwant\s+to\s+die\b/i,
  /\bself[-\s]?harm\b/i,
] as const;

const STRIP = /[\s\p{P}\p{S}]/gu;

export interface CrisisCheck {
  hit: boolean;
  /** 命中的规则（用于日志与测试，不含原文上下文） */
  rule?: string;
}

export function checkCrisis(question: string): CrisisCheck {
  let zh = question.replace(STRIP, '');
  for (const b of ZH_BENIGN) zh = zh.split(b).join('');
  for (const k of ZH_KEYWORDS) {
    if (zh.includes(k)) return { hit: true, rule: k };
  }
  for (const re of EN_PATTERNS) {
    if (re.test(question)) return { hit: true, rule: re.source };
  }
  return { hit: false };
}
