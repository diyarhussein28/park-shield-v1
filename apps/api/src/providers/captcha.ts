import { z } from 'zod';
import type { Captcha } from './ports';

/**
 * The captcha field of every protected request. Real Friendly Captcha v2 solutions are several KB
 * (about 6.5 KB measured in Nov 2026), so the old 4 KB cap rejected every real one before verification.
 */
export const CAPTCHA_SOLUTION_MAX = 16_384;
export const captchaSolution = z.string().max(CAPTCHA_SOLUTION_MAX).optional();

export const DEV_CAPTCHA_SOLUTION = 'dev-captcha-ok';

export type CaptchaEndpoint = 'eu' | 'global';

export const siteverifyUrl = (endpoint: CaptchaEndpoint) =>
  `https://${endpoint}.frcapi.com/api/v2/captcha/siteverify`;

/** Friendly Captcha v2: proof of work, no cookies (SC-05). EU endpoint in production. */
export class FriendlyCaptcha implements Captcha {
  constructor(
    private readonly apiKey: string,
    private readonly sitekey: string,
    private readonly endpoint: CaptchaEndpoint = 'eu',
  ) {}

  async verify(solution: string | undefined): Promise<boolean> {
    if (!solution) return false;
    const res = await fetch(siteverifyUrl(this.endpoint), {
      method: 'POST',
      headers: { 'X-API-Key': this.apiKey, 'content-type': 'application/json' },
      body: JSON.stringify({ response: solution, sitekey: this.sitekey }),
    });
    if (!res.ok) return false;
    const body = (await res.json()) as { success?: boolean };
    return body.success === true;
  }
}

export class DevCaptcha implements Captcha {
  async verify(solution: string | undefined): Promise<boolean> {
    return solution === DEV_CAPTCHA_SOLUTION;
  }
}
