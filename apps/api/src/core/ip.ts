import { isIPv4, isIPv6 } from 'node:net';

/** Truncates immediately: /24 for IPv4, /48 for IPv6. Full addresses are never stored (04-legal §2). */
export function truncateIp(ip: string | undefined): string {
  if (!ip) return 'unknown';
  const v4 = ip.startsWith('::ffff:') ? ip.slice(7) : ip;
  if (isIPv4(v4)) return `${v4.split('.').slice(0, 3).join('.')}.0/24`;
  if (isIPv6(ip)) {
    const [head = '', tail = ''] = ip.split('::');
    const left = head ? head.split(':') : [];
    const right = tail ? tail.split(':') : [];
    const full = [...left, ...Array(8 - left.length - right.length).fill('0'), ...right];
    return `${full
      .slice(0, 3)
      .map((h) => h || '0')
      .join(':')}::/48`;
  }
  return 'unknown';
}

/**
 * Coarse device label ("Chrome · Windows") stored with a session instead of the raw User-Agent:
 * enough to notice a new device (US-05) without keeping a fingerprint-like string.
 */
export function deviceLabel(userAgent: string | undefined): string {
  const ua = userAgent ?? '';
  const browser =
    (/Edg\//.test(ua) && 'Edge') ||
    (/SamsungBrowser\//.test(ua) && 'Samsung Internet') ||
    (/Firefox\/|FxiOS\//.test(ua) && 'Firefox') ||
    (/Chrome\/|CriOS\//.test(ua) && 'Chrome') ||
    (/Safari\//.test(ua) && 'Safari') ||
    'Browser';
  const os =
    (/iPhone|iPad|iPod/.test(ua) && 'iOS') ||
    (/Android/.test(ua) && 'Android') ||
    (/Windows/.test(ua) && 'Windows') ||
    (/Mac OS X|Macintosh/.test(ua) && 'macOS') ||
    (/Linux/.test(ua) && 'Linux') ||
    'unknown OS';
  return `${browser} · ${os}`;
}
