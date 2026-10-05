import { createHash } from 'node:crypto';

// 客户端 IP（04 §6）：应用只监听 127.0.0.1，X-Real-IP 由 nginx 覆盖写入，可信。
// 其次取 X-Forwarded-For 的第一跳，都没有则为 'unknown'。只以加盐哈希的形式使用。

const MAX_IP_LEN = 64;

export function clientIp(headers: Headers): string {
  const real = headers.get('x-real-ip')?.trim();
  if (real && real.length <= MAX_IP_LEN) return real;
  const first = headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  if (first && first.length <= MAX_IP_LEN) return first;
  return 'unknown';
}

/** sha256(salt + ip) 取前 32 位十六进制 */
export function hashIp(ip: string, salt: string): string {
  return createHash('sha256')
    .update(salt + ip)
    .digest('hex')
    .slice(0, 32);
}
