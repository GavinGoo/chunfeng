import { isRenderable } from './fonts';

// 分享图文字清洗（12 §3.3）：satori 默认无法渲染 emoji，遇到字体缺字时还会去远程下载字体。
// 因此：1) 移除 emoji；2) 移除分享图字体都不覆盖的字符；3) 合并多余空白。答案页不受影响。

const KEYCAP = /[0-9#*]️?⃣/gu;
/** emoji 呈现：默认 emoji 呈现的字符、带 VS16 的字符、U+1F000 以上的象形符号 */
const EMOJI =
  /\p{Emoji_Presentation}|\p{Extended_Pictographic}️|[\u{1F000}-\u{1FAFF}]|\p{Regional_Indicator}|\p{Emoji_Modifier}/gu;
/** 残留的组合用字符：零宽连接符、变体选择符、keycap、标签字符 */
const JOINERS = /[‍︎️⃣\u{E0020}-\u{E007F}]/gu;

/** 移除 emoji（含 ZWJ 序列、肤色、旗帜、keycap），保留普通文字与符号 */
export function stripEmoji(text: string): string {
  return text.replace(KEYCAP, '').replace(EMOJI, '').replace(JOINERS, '').replace(/\s+/gu, ' ').trim();
}

/** 分享图可安全渲染的文字：去 emoji、去缺字、合并空白 */
export function sanitizeForShare(text: string): string {
  let out = '';
  for (const ch of stripEmoji(text)) {
    if (/\s/u.test(ch)) out += ' ';
    else if (isRenderable(ch)) out += ch;
  }
  return out.replace(/ {2,}/g, ' ').trim();
}
