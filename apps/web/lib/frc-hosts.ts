/** Friendly Captcha API endpoint, from FRIENDLY_CAPTCHA_ENDPOINT (shared with the API). EU unless "global". */
export type FrcEndpoint = 'eu' | 'global';

export const frcEndpoint = (): FrcEndpoint =>
  process.env.FRIENDLY_CAPTCHA_ENDPOINT === 'global' ? 'global' : 'eu';

/**
 * The API hosts of an endpoint, as the v2 SDK uses them (it falls back from eu to eu0 and eu1, and from
 * global to global0 and global1). The widget runs in an iframe from these hosts and talks to them, so
 * every CSP that shows the widget needs them in both frame-src and connect-src.
 */
export const frcHosts = (endpoint: FrcEndpoint = frcEndpoint()): string =>
  ['', '0', '1'].map((n) => `https://${endpoint}${n}.frcapi.com`).join(' ');
