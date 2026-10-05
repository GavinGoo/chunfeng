import pino from 'pino';
import { getConfig } from './config';

// 结构化日志（04 §7）：永远不记录 Authorization 与密钥
let logger: pino.Logger | undefined;

export function log(): pino.Logger {
  if (!logger) {
    let level: pino.LevelWithSilent = 'info';
    try {
      level = getConfig().logLevel;
    } catch {
      // 配置无效时仍需要能输出错误
    }
    logger = pino({
      level,
      base: { app: 'chunfeng' },
      redact: {
        paths: ['*.authorization', '*.Authorization', 'headers.authorization', '*.apiKey', '*.key'],
        censor: '[redacted]',
      },
    });
  }
  return logger;
}
