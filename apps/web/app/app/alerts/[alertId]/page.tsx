import { redirect } from 'next/navigation';

/**
 * Deep link of an alert (`/app/alerts/<id>`, Universal Link / App Link). With the app installed the
 * phone opens the app and this route is never requested. Without it, the owner lands on /app (the
 * web portal was removed on 2026-11-24; the alert is in the app).
 */
export default function AlertDeepLinkFallback() {
  redirect('/app');
}
