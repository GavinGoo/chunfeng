import { describe, expect, it } from 'vitest';
import { ConfigError, parseConfig } from '@/server/config';

const full = {
  JEV_API_URL: 'http://jev.test/v1/systemone',
  JEV_API_KEY: 'sk-secret-jev-value',
  LLM_API_URL: 'http://llm.test/chat/completions',
  LLM_API_KEY: 'sk-secret-llm-value',
  LLM_MODEL: 'deepseek-flash',
};

describe('parseConfig（01 §8）', () => {
  it('默认值', () => {
    const c = parseConfig(full);
    expect(c.jev.model).toBe('jev-1.13-free');
    expect(c.readingDeadlineMs).toBe(50_000);
    expect(c.scoring).toEqual({ strategy: 'blend', blendWeight: 0.6, softmaxTau: 0.25 });
    expect(c.rateLimit).toEqual({ perMin: 8, perDay: 100 });
    expect(c.readingTtlDays).toBe(0);
    expect(Object.isFrozen(c)).toBe(true);
  });

  it('图片提问（15 §4）：默认关闭，可配置目录与上传限流', () => {
    const c = parseConfig(full);
    expect(c.llm.vision).toBe(false);
    expect(c.imageDir).toBe('./data/images');
    expect(c.uploadRateLimit).toEqual({ perMin: 6, perDay: 60 });
    const on = parseConfig({
      ...full,
      LLM_VISION: 'true',
      IMAGE_DIR: '/var/lib/chunfeng/images',
      UPLOAD_RATE_LIMIT_PER_MIN: '3',
    });
    expect(on.llm.vision).toBe(true);
    expect(on.imageDir).toBe('/var/lib/chunfeng/images');
    expect(on.uploadRateLimit.perMin).toBe(3);
    expect(() => parseConfig({ ...full, LLM_VISION: 'yes' })).toThrow(/LLM_VISION/);
  });

  it('缺失必填项：只列出变量名，不含任何值', () => {
    try {
      parseConfig({ JEV_API_KEY: 'sk-secret-jev-value', LLM_API_KEY: '' });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ConfigError);
      const err = e as ConfigError;
      expect(err.variables.sort()).toEqual(['JEV_API_URL', 'LLM_API_KEY', 'LLM_API_URL', 'LLM_MODEL']);
      expect(err.message).not.toContain('sk-secret');
    }
  });

  it('非法值同样只报变量名', () => {
    expect(() => parseConfig({ ...full, SCORING_BLEND_WEIGHT: '2' })).toThrow(/SCORING_BLEND_WEIGHT/);
    expect(() => parseConfig({ ...full, JEV_API_URL: 'not a url' })).toThrow(ConfigError);
  });

  it('生产环境要求非默认的 IP_HASH_SALT；不再需要 PUBLIC_BASE_URL（D45）', () => {
    expect(() => parseConfig({ ...full, NODE_ENV: 'production', IP_HASH_SALT: 'change-me' })).toThrow(
      /IP_HASH_SALT/,
    );
    expect(() => parseConfig({ ...full, NODE_ENV: 'production', IP_HASH_SALT: 'change-me' })).not.toThrow(
      /PUBLIC_BASE_URL/,
    );
    // .env 里残留的旧变量被忽略
    expect(
      parseConfig({ ...full, NODE_ENV: 'production', IP_HASH_SALT: 'r', PUBLIC_BASE_URL: 'x' }),
    ).not.toHaveProperty('publicBaseUrl');
  });

  it('MOCK_UPSTREAMS=true 时不要求密钥；生产环境禁止 LOG_CONTENT', () => {
    expect(parseConfig({ MOCK_UPSTREAMS: 'true' }).mock.enabled).toBe(true);
    expect(
      parseConfig({
        ...full,
        NODE_ENV: 'production',
        IP_HASH_SALT: 'r',
        LOG_CONTENT: 'true',
      }).logContent,
    ).toBe(false);
  });
});
