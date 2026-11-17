import { createHmac } from 'node:crypto';
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
 * Network part used for the pseudonymous scanner references (abuse protection §0): /24 for IPv4, /64
 * for IPv6, so phones on one mobile network do not share one counter. Never stored.
 */
export function scannerIpPrefix(ip: string | undefined): string {
  if (!ip) return 'unknown';
  const v4 = ip.startsWith('::ffff:') ? ip.slice(7) : ip;
  if (isIPv4(v4)) return truncateIp(v4);
  if (!isIPv6(ip)) return 'unknown';
  const [head = '', tail = ''] = ip.split('::');
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const full = [...left, ...Array(8 - left.length - right.length).fill('0'), ...right];
  return `${full
    .slice(0, 4)
    .map((h) => (h || '0').toLowerCase().replace(/^0+(?=.)/, ''))
    .join(':')}::/64`;
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

/**
 * Proof of where a legal request came from without storing an address: HMAC of the truncated
 * address with a salt derived per UTC day from the server secret. The salt itself is never stored,
 * so after the day nobody can test addresses against the hash.
 */
export function ipHash(secretBase64: string, ipPrefix: string, at = new Date()): Buffer {
  const day = at.toISOString().slice(0, 10);
  const salt = createHmac('sha256', Buffer.from(secretBase64, 'base64'))
    .update(`ip-salt:${day}`)
    .digest();
  return createHmac('sha256', salt).update(ipPrefix).digest();
}
