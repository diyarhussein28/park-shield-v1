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

/**
 * `next dev` only serves its scripts to localhost. When WEB_BASE_URL points at the PC's network address
 * (testing the app on a phone, AUTH.md), that host must be allowed too, or pages opened on the phone
 * never run their JavaScript (the sign-in bridge page needs it). Has no effect on production builds.
 */
const devHost = (() => {
  try {
    const host = new URL(process.env.WEB_BASE_URL ?? '').hostname;
    return host && host !== 'localhost' && host !== '127.0.0.1' ? [host] : [];
  } catch {
    return [];
  }
})();

const config: NextConfig = {
  allowedDevOrigins: devHost,
  // A production build next to a running `next dev` must not share its folder (HMR hash mismatch loop).
  distDir: process.env.NEXT_DIST_DIR ?? '.next',
  // Docker image on our own servers (the Vercel preview was dropped on 2026-11-24).
  output: 'standalone',
  outputFileTracingRoot: join(import.meta.dirname, '..', '..'),
  transpilePackages: ['@parkshield/ui'],
  // The captcha widget (client code) uses the same endpoint setting as the API; empty means EU.
  env: { FRIENDLY_CAPTCHA_ENDPOINT: process.env.FRIENDLY_CAPTCHA_ENDPOINT || 'eu' },
  poweredByHeader: false,
  reactStrictMode: true,
  // Same-origin /v1 in every environment: Caddy routes it to the API in production, Next proxies it locally.
  async rewrites() {
    const api = process.env.API_INTERNAL_URL ?? 'http://127.0.0.1:4000';
    return [{ source: '/v1/:path*', destination: `${api}/v1/:path*` }];
  },
  // App first (owner decision 2026-11-24): sign-in, the owner portal and the checkout live in the app.
  // Old links (e-mails, letters, bookmarks) land on /app, which links to the stores. `/aktivieren`
  // (pre-printed partner decals, now set up in the app) and `/antwort` (the old e-mail reply page)
  // were removed the same day.
  async redirects() {
    return [
      '/anmelden',
      '/anmelden/:path*',
      '/konto',
      '/konto/:path*',
      '/aktivieren',
      '/antwort',
    ].map((source) => ({
      source,
      destination: '/app',
      permanent: true,
    }));
  },
  async headers() {
    // Previews (SITE_NOINDEX=1) stay out of search engines, e.g. while the Impressum has placeholders.
    const robots =
      process.env.SITE_NOINDEX === '1' ? [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }] : [];
    return [
      { source: '/:path*', headers: [...securityHeaders, ...robots] },
      // Phase 2 alert photos: the scanner page (and only it) may open the rear camera. A later rule
      // overrides the same header key of an earlier one.
      {
        source: '/s/:path*',
        headers: [
          {
            key: 'Permissions-Policy',
            value: 'camera=(self), microphone=(), geolocation=(), interest-cohort=()',
          },
        ],
      },
      // Browsers must pick up a new service worker at once (it only shows push notifications).
      { source: '/sw.js', headers: [{ key: 'Cache-Control', value: 'no-cache' }] },
    ];
  },
};

export default config;
