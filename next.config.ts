import type { NextConfig } from 'next';

const isDev = process.env.NODE_ENV !== 'production';

const csp = [
  "default-src 'self'",
  "img-src 'self' data: blob:",
  "style-src 'self' 'unsafe-inline'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`,
  "font-src 'self'",
  `connect-src 'self'${isDev ? ' ws: wss:' : ''}`,
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

const nextConfig: NextConfig = {
  output: 'standalone',
  // E2E 同时起两个实例（LLM_VISION 开与关，15 §16.4）时，第二个实例用独立的构建目录
  distDir: process.env.NEXT_DIST_DIR || '.next',
  poweredByHeader: false,
  serverExternalPackages: ['better-sqlite3', 'pino', 'subset-font'],
  outputFileTracingIncludes: {
    '/api/readings/[id]/share-image': ['./assets/fonts/**', './assets/share/**'],
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: csp },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};

export default nextConfig;
