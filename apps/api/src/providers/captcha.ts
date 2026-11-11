import type { Captcha } from './ports';

export const DEV_CAPTCHA_SOLUTION = 'dev-captcha-ok';

/** Friendly Captcha v2, EU endpoint: proof of work, no cookies (SC-05). */
export class FriendlyCaptcha implements Captcha {
  constructor(
    private readonly apiKey: string,
    private readonly sitekey: string,
  ) {}

  async verify(solution: string | undefined): Promise<boolean> {
    if (!solution) return false;
    const res = await fetch('https://eu.frcapi.com/api/v2/captcha/siteverify', {
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
