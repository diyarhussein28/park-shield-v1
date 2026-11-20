import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { api } from './api';
import { ACK_ACTION, ALERT_CATEGORY, ALERT_CHANNEL, APP_VERSION, HAS_FIREBASE } from './config';
import { lang, t } from './i18n';
import { clearDeviceToken, getDeviceToken, setDeviceToken } from './session';

export type PushPermission = 'granted' | 'denied' | 'undetermined';

/**
 * One-time set-up at app start: how notifications show while the app is open, the Android channel
 * (high importance) and the iOS category with the „Ich komme" action. The push itself carries only a
 * generic text and ids (FCM is a Google service); the app loads the details from our API.
 */
export async function configureNotifications(): Promise<void> {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
  if (Platform.OS === 'android') {
    // Android 13+: the channel must exist before a token is requested, or no prompt appears.
    await Notifications.setNotificationChannelAsync(ALERT_CHANNEL, {
      name: lang() === 'en' ? 'Alerts' : 'Warnungen',
      importance: Notifications.AndroidImportance.MAX,
      sound: 'default',
      vibrationPattern: [0, 250, 150, 250],
    });
  }
  await Notifications.setNotificationCategoryAsync(ALERT_CATEGORY, [
    {
      identifier: ACK_ACTION,
      buttonTitle: t('coming'),
      // Opens the app, which sends the acknowledgement and shows that it worked.
      options: { opensAppToForeground: true },
    },
  ]);
}

export async function permission(): Promise<PushPermission> {
  const p = await Notifications.getPermissionsAsync();
  if (p.granted) return 'granted';
  return p.canAskAgain ? 'undetermined' : 'denied';
}

/**
 * The system prompt, after our own explanation screen (app/push-erlauben.tsx) or the button on
 * „Benachrichtigungen“. A grant registers this device at once, so the owner does not have to restart
 * the app before „App“ counts as set up.
 */
export async function requestPermission(): Promise<PushPermission> {
  const p = await Notifications.requestPermissionsAsync({
    ios: { allowAlert: true, allowSound: true, allowBadge: false },
  });
  if (p.granted) {
    await registerDevice().catch(() => false);
    return 'granted';
  }
  // iOS can answer without showing its dialog (the status stays „not determined“, e.g. when the app
  // was not fully in the foreground yet). That is no refusal: the „Erlauben“ button stays.
  if (p.canAskAgain) return 'undetermined';
  // A real refusal: the banner stays in the app; the API sends one e-mail hint a day.
  await api('/v1/app/push-denied', {
    body: { platform: Platform.OS === 'ios' ? 'ios' : 'android' },
  }).catch(() => undefined);
  return 'denied';
}

/**
 * The FCM registration token. React Native Firebase on both platforms (on iOS it maps the APNs token to
 * an FCM token; expo-notifications' device token would be the raw APNs token, which FCM cannot address).
 * Loaded lazily: builds without Firebase (Expo Go, UI development) simply have no token.
 */
async function fcmToken(): Promise<string | null> {
  if (!HAS_FIREBASE) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const m =
      require('@react-native-firebase/messaging') as typeof import('@react-native-firebase/messaging');
    const messaging = m.getMessaging();
    return await m.getToken(messaging);
  } catch {
    return null;
  }
}

/** Registers (or refreshes) this device with the API: on sign-in and on every app start. */
export async function registerDevice(): Promise<boolean> {
  if ((await permission()) !== 'granted') return false;
  const token = await fcmToken();
  if (!token) return false;
  await api('/v1/app/devices/register', {
    body: {
      fcmToken: token,
      platform: Platform.OS === 'ios' ? 'ios' : 'android',
      appVersion: APP_VERSION.slice(0, 20),
      locale: lang(),
    },
  });
  await setDeviceToken(token);
  return true;
}

/** On sign-out: the phone gets no more alerts. */
export async function unregisterDevice(): Promise<void> {
  const token = await getDeviceToken();
  if (token) {
    await api(`/v1/app/devices/${encodeURIComponent(token)}`, { method: 'DELETE' }).catch(
      () => undefined,
    );
    await clearDeviceToken();
  }
  if (!HAS_FIREBASE) return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const m =
      require('@react-native-firebase/messaging') as typeof import('@react-native-firebase/messaging');
    await m.deleteToken(m.getMessaging());
  } catch {
    // nothing registered
  }
}

/** Data of a ParkShield push: { alertId, type, kind } (strings). */
export function alertIdOf(response: Notifications.NotificationResponse): string | null {
  const { content, trigger } = response.notification.request;
  // iOS: expo-notifications fills `data` of a remote notification only from the payload's `body` key
  // (our API sends it). Older pushes carry the ids at the top level: read the raw payload then.
  const raw = (trigger as { payload?: Record<string, unknown> } | null)?.payload;
  const fromData = (content.data as Record<string, unknown> | null | undefined)?.alertId;
  const fromRaw = raw?.alertId ?? (raw?.body as Record<string, unknown> | undefined)?.alertId;
  const id = typeof fromData === 'string' ? fromData : typeof fromRaw === 'string' ? fromRaw : null;
  return id && /^[0-9a-f-]{36}$/i.test(id) ? id : null;
}

/**
 * A tap on a notification or its „Ich komme" action. The action acknowledges at once (single use on the
 * server, a second tap changes nothing); either way the alert opens.
 */
export async function handleResponse(
  response: Notifications.NotificationResponse,
  open: (alertId: string) => void,
): Promise<'acknowledged' | 'opened' | 'ignored'> {
  const alertId = alertIdOf(response);
  if (!alertId) return 'ignored';
  if (response.actionIdentifier === ACK_ACTION) {
    await api(`/v1/app/alerts/${alertId}/ack`, { body: { reply: 'coming' } }).catch(
      () => undefined,
    );
    open(alertId);
    return 'acknowledged';
  }
  open(alertId);
  return 'opened';
}
