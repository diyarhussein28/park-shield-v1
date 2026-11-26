// Paying inside the ParkShield app (apps/api/src/billing/app-return.ts): Stripe only returns to https
// pages, so it comes back here and this page hands the result to the app with a redirect to the app's
// own scheme. The target is checked exactly like the API checks it, so this is never an open redirect:
// `parkshield://…` always, Expo Go's `exp://…` only where test helpers may exist.
export const dynamic = 'force-dynamic';

const APP = /^parkshield:\/\/[\w\-./]*(\?[\w\-.=&%]*)?$/;
const EXPO_GO = /^exps?:\/\/[\w\-.:]+(\/[\w\-./]*)?(\/--\/[\w\-./]*)?$/;
const testEnvironment = () => process.env.NODE_ENV !== 'production' || process.env.APP_ENV === 'ci';

export function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const target = q.get('u') ?? '';
  if (!APP.test(target) && !(testEnvironment() && EXPO_GO.test(target))) {
    // Opened in a normal browser (or with a foreign target): the app page explains where to go and
    // links the stores, instead of a bare „Not found“ (QA NOLOGIN-10). Never the given target.
    return new Response(null, {
      status: 303,
      headers: { location: '/app', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' },
    });
  }
  const back = new URLSearchParams();
  for (const key of ['to', 'result', 'session_id']) {
    const v = q.get(key);
    if (v && /^[\w-]{1,200}$/.test(v)) back.set(key, v);
  }
  const location = `${target}${target.includes('?') ? '&' : '?'}${back}`;
  return new Response(null, {
    status: 302,
    headers: { location, 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' },
  });
}
