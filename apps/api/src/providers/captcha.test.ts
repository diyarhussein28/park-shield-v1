import { afterEach, describe, expect, it, vi } from 'vitest';
import { CAPTCHA_SOLUTION_MAX, captchaSolution, FriendlyCaptcha, siteverifyUrl } from './captcha';

describe('Friendly Captcha verification (SC-05)', () => {
  it('accepts real v2 solutions of several KB in request bodies', () => {
    expect(captchaSolution.safeParse('A'.repeat(6505)).success).toBe(true);
    expect(captchaSolution.safeParse(undefined).success).toBe(true);
    expect(captchaSolution.safeParse('A'.repeat(CAPTCHA_SOLUTION_MAX + 1)).success).toBe(false);
  });

  afterEach(() => vi.unstubAllGlobals());

  it.each([
    ['eu', 'https://eu.frcapi.com/api/v2/captcha/siteverify'],
    ['global', 'https://global.frcapi.com/api/v2/captcha/siteverify'],
  ] as const)('%s endpoint verifies at %s', async (endpoint, url) => {
    expect(siteverifyUrl(endpoint)).toBe(url);
    const fetch = vi.fn(async () => new Response(JSON.stringify({ success: true })));
    vi.stubGlobal('fetch', fetch);
    await expect(new FriendlyCaptcha('key', 'site', endpoint).verify('solution')).resolves.toBe(
      true,
    );
    expect(fetch).toHaveBeenCalledWith(url, expect.objectContaining({ method: 'POST' }));
  });

  it('defaults to the EU endpoint and rejects a missing solution without a request', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ success: false })));
    vi.stubGlobal('fetch', fetch);
    await expect(new FriendlyCaptcha('key', 'site').verify(undefined)).resolves.toBe(false);
    expect(fetch).not.toHaveBeenCalled();
    await new FriendlyCaptcha('key', 'site').verify('x');
    expect(fetch).toHaveBeenCalledWith(siteverifyUrl('eu'), expect.anything());
  });
});
