import { negotiateLocale } from '@parkshield/i18n';
import type { NextRequest } from 'next/server';
import {
  renderInactive,
  renderRateLimited,
  renderScanner,
  renderUnclaimed,
  scannerCsp,
  type ScanPageData,
} from '@/lib/scanner/render';

export const dynamic = 'force-dynamic';

const API = process.env.API_INTERNAL_URL ?? 'http://127.0.0.1:4000';
const SITEKEY = process.env.NEXT_PUBLIC_FRIENDLY_CAPTCHA_SITEKEY ?? '';

/**
 * Scanner page (US-14): plain server-rendered HTML with a few KB of inline JS instead of a React bundle,
 * so it renders in well under 1.5 s on 4G. No cookies are read or set (§25 TDDDG).
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const locale = negotiateLocale(req.headers.get('accept-language'));
  const headers: Record<string, string> = { 'user-agent': req.headers.get('user-agent') ?? '' };
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) headers['x-forwarded-for'] = fwd; // the API derives the truncated IP for rate limits

  let status: number;
  let html: string;
  try {
    const res = await fetch(`${API}/v1/scan/${encodeURIComponent(code)}`, {
      headers,
      cache: 'no-store',
    });
    const data = res.ok ? ((await res.json()) as ScanPageData | { unclaimed: true }) : null;
    if (data && 'unclaimed' in data) {
      status = 200;
      html = renderUnclaimed(locale, code.toUpperCase());
    } else if (data) {
      status = 200;
      html = renderScanner(
        locale,
        code.toUpperCase(),
        data,
        SITEKEY ? { mode: 'frc', sitekey: SITEKEY } : { mode: 'dev', solution: 'dev-captcha-ok' },
      );
    } else if (res.status === 429) {
      status = 429;
      html = renderRateLimited(locale);
    } else {
      status = 404;
      html = renderInactive(locale);
    }
  } catch {
    status = 503;
    html = renderInactive(locale);
  }

  return new Response(html, {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'content-security-policy': scannerCsp(Boolean(SITEKEY)),
      'referrer-policy': 'no-referrer',
      'x-robots-tag': 'noindex, nofollow',
      'content-language': locale,
    },
  });
}
