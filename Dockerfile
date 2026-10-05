# 春风 · 生产镜像（13 §5.2）：在镜像内按 Linux 构建原生模块（better-sqlite3、sharp），运行 standalone 产物
# 全部基于 node:24-alpine（musl）：构建与运行同一 libc，原生模块装的是 linuxmusl 版本
FROM node:24-alpine AS base
ENV NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /app

FROM base AS deps
# better-sqlite3 没有匹配的预编译包时从源码编译
RUN apk add --no-cache python3 make g++
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm build

# 运行时只需要 node 本身：删掉 npm、npx、corepack、yarn 与 C 头文件，再整体拷进 scratch 压成一层，
# 被删的文件才真正不占镜像体积（在上层 RUN rm 只是遮住，下层仍在）
FROM node:24-alpine AS runtime
RUN rm -rf /usr/local/lib/node_modules /usr/local/include \
    /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
    /usr/local/bin/yarn /usr/local/bin/yarnpkg /opt/yarn-* \
    /usr/local/share/doc /usr/local/share/man \
  && mkdir -p /app/data && chown node:node /app/data

FROM scratch AS runner
COPY --from=runtime / /
WORKDIR /app
# scratch 不继承父镜像的 ENV，PATH 须显式设置
# HOSTNAME 必须显式设置：Docker 会把它设成容器 ID，standalone 服务器据此监听
ENV PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
    NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
COPY --from=builder --chown=node:node /app/public ./public
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
# 数据库、分享图缓存与上传图片都在 /app/data（由 docker-compose.yml 挂载数据卷）
USER node
EXPOSE 3000
CMD ["node", "server.js"]
