import { describe, expect, it } from 'vitest';
import { deviceLabel, truncateIp } from './ip';

describe('truncateIp', () => {
  it.each([
    ['203.0.113.77', '203.0.113.0/24'],
    ['::ffff:198.51.100.9', '198.51.100.0/24'],
    ['2001:db8:abcd:12::1', '2001:db8:abcd::/48'],
    ['2001:db8::1', '2001:db8:0::/48'],
    [undefined, 'unknown'],
    ['garbage', 'unknown'],
  ])('%s -> %s', (ip, expected) => {
    expect(truncateIp(ip)).toBe(expected);
  });
});

describe('deviceLabel', () => {
  it.each([
    [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36',
      'Chrome · Windows',
    ],
    [
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
      'Safari · iOS',
    ],
    [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0 Safari/537.36 Edg/140.0',
      'Edge · Windows',
    ],
    ['Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0', 'Firefox · Linux'],
    [undefined, 'Browser · unknown OS'],
  ])('%s', (ua, expected) => {
    expect(deviceLabel(ua)).toBe(expected);
  });
});
