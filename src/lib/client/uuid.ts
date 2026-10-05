// requestId 生成（08 §4）：crypto.randomUUID 仅在安全上下文（HTTPS / localhost）可用，
// 不可用时（如手机经局域网 IP 访问开发服务器）回退到基于 getRandomValues 的 UUID v4。

export function uuidFromBytes(bytes: Uint8Array): string {
  const b = Uint8Array.from(bytes.subarray(0, 16));
  b[6] = (b[6]! & 0x0f) | 0x40; // 版本 4
  b[8] = (b[8]! & 0x3f) | 0x80; // RFC 4122 变体
  const hex = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function randomUUID(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c && typeof c.randomUUID === 'function') {
    try {
      return c.randomUUID();
    } catch {
      // 非安全上下文中可能抛错，继续回退
    }
  }
  const bytes = new Uint8Array(16);
  if (c && typeof c.getRandomValues === 'function') {
    c.getRandomValues(bytes);
  } else {
    // 极旧环境的最后兜底（不用于安全场景，仅作幂等键）
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return uuidFromBytes(bytes);
}
