import { redirect } from 'next/navigation';

/**
 * Deep link of an alert (`/app/alerts/<id>`, Universal Link / App Link). With the app installed the
 * phone opens the app and this route is never requested. Without it, the owner lands in the alert
 * history of the web portal (sign-in required), which shows the same alert and its view link.
 */
export default function AlertDeepLinkFallback() {
  redirect('/konto/verlauf');
}
