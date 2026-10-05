import { describe, expect, it } from 'vitest';
import { classifyShareEnv, shareImageUrl } from '@/components/share/shareEnv';

const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const WECHAT = `${IPHONE} MicroMessenger/8.0.50(0x18003237) NetType/WIFI Language/zh_CN`;
const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/140.0 Safari/537.36';

describe('分享弹层环境识别（12 §4）', () => {
  it('微信优先', () => {
    expect(classifyShareEnv({ userAgent: WECHAT, canShareFiles: true, finePointer: false })).toBe('wechat');
  });
  it('移动端按是否支持文件分享区分', () => {
    expect(classifyShareEnv({ userAgent: IPHONE, canShareFiles: true, finePointer: false })).toBe(
      'mobileShare',
    );
    expect(classifyShareEnv({ userAgent: IPHONE, canShareFiles: false, finePointer: false })).toBe('mobile');
  });
  it('桌面精确指针 → 下载；即使桌面浏览器支持文件分享', () => {
    expect(classifyShareEnv({ userAgent: MAC, canShareFiles: true, finePointer: true })).toBe('desktop');
  });
  it('图片 URL：不带版本，重试时追加 r', () => {
    expect(shareImageUrl('AbCdEfGhIjKl', 0)).toBe('/api/readings/AbCdEfGhIjKl/share-image');
    expect(shareImageUrl('AbCdEfGhIjKl', 3)).toBe('/api/readings/AbCdEfGhIjKl/share-image?r=3');
  });
});
