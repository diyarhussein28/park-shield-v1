import { createHmac, timingSafeEqual } from 'node:crypto';

/** X-Twilio-Signature: HMAC-SHA1 with the auth token over the URL plus the sorted form parameters. */
export function twilioSignature(
  authToken: string,
  url: string,
  params: Record<string, unknown>,
): string {
  const data = Object.keys(params)
    .sort()
    .reduce((acc, k) => {
      const v = params[k];
      return acc + (Array.isArray(v) ? v.map((x) => k + String(x)).join('') : k + String(v ?? ''));
    }, url);
  return createHmac('sha1', authToken).update(data, 'utf8').digest('base64');
}

export function validTwilioSignature(
  authToken: string,
  url: string,
  params: Record<string, unknown>,
  signature: string | undefined,
): boolean {
  if (!authToken || !signature) return false;
  const expected = Buffer.from(twilioSignature(authToken, url, params));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}
