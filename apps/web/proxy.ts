import { NextResponse, type NextRequest } from 'next/server';

/**
 * ASVS 14.4.3 / 50.x: strict Content-Security-Policy with a fresh nonce per request. Next.js reads the
 * nonce from the request's CSP header and puts it on its own scripts. Inline style attributes stay
 * allowed (the progress bar uses one); a nonce in style-src would make browsers ignore 'unsafe-inline'.
 * The scanner page (/s/…) sets its own, even stricter hash-based policy, and /v1 belongs to the API.
 */
export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const dev = process.env.NODE_ENV === 'development';
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self'",
    // Friendly Captcha (EU endpoint) solves its puzzle in a web worker.
    "connect-src 'self' https://eu.frcapi.com https://eu1.frcapi.com",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(dev ? [] : ['upgrade-insecure-requests']),
  ].join('; ');

  const headers = new Headers(request.headers);
  headers.set('x-nonce', nonce);
  headers.set('content-security-policy', csp);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set('content-security-policy', csp);
  return response;
}

export const config = {
  matcher: [
    {
      source:
        '/((?!v1/|s/|_next/static|_next/image|icons/|sw\\.js|manifest\\.webmanifest|frc-sdk\\.js|favicon).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
