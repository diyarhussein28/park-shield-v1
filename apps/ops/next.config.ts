import { join } from 'node:path';
import type { NextConfig } from 'next';

const config: NextConfig = {
  output: 'standalone',
  outputFileTracingRoot: join(import.meta.dirname, '..', '..'),
  transpilePackages: ['@parkshield/ui'],
  poweredByHeader: false,
  reactStrictMode: true,
  distDir: process.env.NEXT_DIST_DIR ?? '.next',
  // Same-origin /ops/v1 so the staff cookies stay host-only on the ops domain (Caddy does this on the VPN).
  async rewrites() {
    const host = process.env.OPS_API_HOST ?? '127.0.0.1';
    const port = process.env.OPS_API_PORT ?? '4001';
    return [{ source: '/ops/v1/:path*', destination: `http://${host}:${port}/ops/v1/:path*` }];
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
          { key: 'Cache-Control', value: 'no-store' },
        ],
      },
    ];
  },
};

export default config;
