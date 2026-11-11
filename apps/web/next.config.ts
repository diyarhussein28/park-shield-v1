import { join } from 'node:path';
import type { NextConfig } from 'next';

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'no-referrer' },
  { key: 'X-Frame-Options', value: 'DENY' },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
  },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
];

const config: NextConfig = {
  // A production build next to a running `next dev` must not share its folder (HMR hash mismatch loop).
  distDir: process.env.NEXT_DIST_DIR ?? '.next',
  // Docker image on our own servers; Vercel (temporary website preview) builds its own output.
  output: process.env.VERCEL ? undefined : 'standalone',
  outputFileTracingRoot: join(import.meta.dirname, '..', '..'),
  transpilePackages: ['@parkshield/ui'],
  poweredByHeader: false,
  reactStrictMode: true,
  // Same-origin /v1 in every environment: Caddy routes it to the API in production, Next proxies it locally.
  async rewrites() {
    const api = process.env.API_INTERNAL_URL ?? 'http://127.0.0.1:4000';
    return [{ source: '/v1/:path*', destination: `${api}/v1/:path*` }];
  },
  async headers() {
    // Previews (SITE_NOINDEX=1) stay out of search engines, e.g. while the Impressum has placeholders.
    const robots =
      process.env.SITE_NOINDEX === '1' ? [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }] : [];
    return [
      { source: '/:path*', headers: [...securityHeaders, ...robots] },
      // Browsers must pick up a new service worker at once (it only shows push notifications).
      { source: '/sw.js', headers: [{ key: 'Cache-Control', value: 'no-cache' }] },
    ];
  },
};

export default config;
