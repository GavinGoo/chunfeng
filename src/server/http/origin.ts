// Origin 校验（04 §6）：Origin 缺失，或其 host 与请求的 Host 一致才放行，防止第三方网页借访客的浏览器把本站当作免费的 LLM 代理。
// 「本站」由请求自身的域名界定（D45）：应用只经 nginx 的 HTTPS 站点可达，别的域名过不了证书校验（13 §5.4、D46），所以多域名无需配置。
// 另提供请求自身的对外地址（12 §3.1），供分享图二维码与 og:image 使用。

// 域名 / IPv4 / IPv6（方括号）可带端口；不含路径、查询、空白与控制字符
const HOST_RE = /^(?:[A-Za-z0-9._-]+|\[[0-9A-Fa-f:.]+\])(?::\d{1,5})?$/;

function firstValue(raw: string | null): string | null {
  const first = raw?.split(',')[0]?.trim();
  return first ? first : null;
}

/** 请求的 Host：先取 nginx 转发的 X-Forwarded-Host（第一个值），其次 Host */
function requestHost(headers: Headers): string | null {
  return firstValue(headers.get('x-forwarded-host')) ?? firstValue(headers.get('host'));
}

/**
 * 请求自身的对外地址（`协议://域名`），用于分享图二维码与 og:image：用户从哪个域名访问，就指向哪个域名。
 * 反向代理在 `X-Forwarded-Host` / `X-Forwarded-Proto` 里带上原始域名与协议（13 §5.4）；
 * 没有 `X-Forwarded-Proto` 说明前面没有代理，应用本身只说 HTTP，按 http 处理。
 * 域名缺失或不合法时返回 null。只用于拼 URL，不参与任何安全判定。
 */
export function requestBaseUrl(headers: Headers): string | null {
  const host = requestHost(headers);
  if (!host || !HOST_RE.test(host)) return null;
  const proto = firstValue(headers.get('x-forwarded-proto'))?.toLowerCase();
  return `${proto === 'https' ? 'https' : 'http'}://${host}`;
}

/**
 * 请求是否「看起来来自本站」（12 §3.1，D35）：
 * 浏览器加载本站页面里的图片会带 `Sec-Fetch-Site: same-origin`；老浏览器（Safari < 16.4 等）至少带 `Referer`，
 * 其 host 与请求的 Host 一致。爬虫、直接 GET 通常两者都没有。
 */
export function isSameSiteRequest(headers: Headers): boolean {
  const site = firstValue(headers.get('sec-fetch-site'))?.toLowerCase();
  if (site) return site === 'same-origin';
  const referer = firstValue(headers.get('referer'));
  if (!referer) return false;
  const host = requestHost(headers);
  if (!host) return false;
  try {
    return new URL(referer).host === host.toLowerCase();
  } catch {
    return false;
  }
}

/**
 * Origin 缺失，或其 host 与请求 Host 一致（大小写不敏感，不比较协议）才放行。
 * 浏览器里网页脚本改不了这两个头，所以挡得住第三方网页；脚本直连可以随意伪造或省略，那由限流负责（04 §6）。
 */
export function isOriginAllowed(headers: Headers): boolean {
  const origin = headers.get('origin');
  if (origin === null || origin === '') return true;
  let originHost: string;
  try {
    originHost = new URL(origin).host; // "null" 等非法值抛错
  } catch {
    return false;
  }
  const host = requestHost(headers);
  return originHost !== '' && host !== null && originHost === host.toLowerCase();
}
