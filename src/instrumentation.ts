// 服务启动钩子：校验配置（缺失必填项时启动失败，只列出变量名）、执行数据库迁移、启动保留期清理。
// 只在 Node 运行时执行；`next build` 阶段跳过，避免因缺少密钥而构建失败（13 §3）。

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  if (process.env.NEXT_PHASE === 'phase-production-build') return;
  const { bootstrapServer } = await import('./server/bootstrap');
  await bootstrapServer();
}
