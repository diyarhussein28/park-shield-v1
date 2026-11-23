import Constants from 'expo-constants';

/** API origin (the website; /v1 and /v1/socket.io are routed to the API there). */
export const API_URL: string = String(
  (Constants.expoConfig?.extra as { apiUrl?: string } | undefined)?.apiUrl ??
    'https://park-shield.de',
).replace(/\/$/, '');

/** Whether this build includes Firebase (push). Without it the app works, but gets no push. */
export const HAS_FIREBASE = Boolean(
  (Constants.expoConfig?.extra as { firebase?: boolean } | undefined)?.firebase,
);

/**
 * The public website (help centre, FAQ, privacy policy). Always the live domain, also in test builds:
 * the test server's website sits behind basic auth, the help pages are the same.
 */
export const WEBSITE_URL = 'https://park-shield.de';

export const APP_VERSION = Constants.expoConfig?.version ?? '1.0.0';

/** iOS notification category / Android click action carrying the „Ich komme" action (API side too). */
export const ALERT_CATEGORY = 'PS_ALERT';
export const ACK_ACTION = 'PS_ACK';
export const ALERT_CHANNEL = 'alerts';
