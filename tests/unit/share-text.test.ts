import { describe, expect, it } from 'vitest';
import { sanitizeForShare, stripEmoji } from '@/server/share/text';

describe('分享图文字清洗（12 §3.3）', () => {
  it('移除单个 emoji、ZWJ 序列、肤色、旗帜、keycap 与变体选择符', () => {
    expect(stripEmoji('周末去海边🏖️还是进山🌲？')).toBe('周末去海边还是进山？');
    expect(stripEmoji('一家人👨‍👩‍👧都去')).toBe('一家人都去');
    expect(stripEmoji('点赞👍🏽')).toBe('点赞');
    expect(stripEmoji('回国🇨🇳吗')).toBe('回国吗');
    expect(stripEmoji('选1️⃣还是2️⃣')).toBe('选还是');
    expect(stripEmoji('❤️ 爱')).toBe('爱');
  });

  it('保留普通文字、数字与常见符号', () => {
    expect(stripEmoji('要不要换 MacBook Pro 14"？')).toBe('要不要换 MacBook Pro 14"？');
    expect(stripEmoji('我該不該辭職')).toBe('我該不該辭職');
    expect(stripEmoji('A&B © 2026 · 50%')).toBe('A&B © 2026 · 50%');
  });

  it('合并空白', () => {
    expect(stripEmoji('  你好 🌸  世界 ')).toBe('你好 世界');
  });

  it('sanitizeForShare 额外移除字体不覆盖的字符（谚文等），全 emoji 时为空', () => {
    expect(sanitizeForShare('要不要去한국旅行🌸')).toBe('要不要去旅行');
    expect(sanitizeForShare('繁體中文與 English mixed')).toBe('繁體中文與 English mixed');
    expect(sanitizeForShare('🌸🌸')).toBe('');
  });
});
