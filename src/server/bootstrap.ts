import { ConfigError, getConfig } from './config';
import { probeSharp, visionStatus } from './image/vision';
import { log } from './log';
import { getDb } from './reading/db';
import { startTtlCleanup } from './reading/maintenance';

// 由 src/instrumentation.ts 在服务启动时调用。

export async function bootstrapServer(): Promise<void> {
  let cfg: ReturnType<typeof getConfig>;
  try {
    cfg = getConfig();
  } catch (e) {
    if (e instanceof ConfigError) {
      // ConfigError 的 message 只包含变量名，不含任何值
      console.error(`[chunfeng] ${e.message}`);
      if (process.env.NODE_ENV === 'production') process.exit(1);
    }
    throw e;
  }
  getDb(); // 打开连接并执行迁移
  startTtlCleanup();
  await probeSharp(); // 失败时（仅 LLM_VISION=true）记 fatal，图片功能视为不可用（15 §4）
  log().info({
    evt: 'server.started',
    mock: cfg.mock.enabled,
    jevModel: cfg.jev.model,
    llmModel: cfg.llm.model,
    ttlDays: cfg.readingTtlDays,
    vision: visionStatus(),
  });
}
