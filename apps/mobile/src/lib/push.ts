import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { api } from './api';
import {
  ACK_ACTION,
  ALERT_CATEGORY,
  ALERT_CHANNEL,
  APP_VERSION,
  BRB_CATEGORY,
  BRB_END_ACTION,
  BRB_EXTEND_ACTION,
  HAS_FIREBASE,
} from './config';
import { lang, t } from './i18n';
import { clearDeviceToken, getDeviceToken, setDeviceToken } from './session';
import { endStatus, extendStatus, statusChanged } from './vehicle-status';

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
  // „Bin gleich zurück“ ends in 1 min: „+5 Min“ and „Beenden“ (the app calls the API, then shows the
  // vehicle with the updated banner).
  await Notifications.setNotificationCategoryAsync(BRB_CATEGORY, [
    {
      identifier: BRB_EXTEND_ACTION,
      buttonTitle: t('brbExtend'),
      options: { opensAppToForeground: true },
    },
    {
      identifier: BRB_END_ACTION,
      buttonTitle: t('brbEnd'),
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
  // A real refusal: the warning stays in the app (Start, Warnungen, Benachrichtigungen); the API is
  // told so it can send its account hint.
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

/**
 * One field of a ParkShield push ({ alertId, kind }, both strings; since 2026-11-21 there is no
 * `type` any more, the app loads everything else from the API). iOS: expo-notifications fills
 * `data` of a remote notification only from the payload's `body` key (our API sends it); older pushes
 * carry the ids at the top level, so the raw payload is read as well.
 */
function pushField(response: Notifications.NotificationResponse, key: string): string | null {
  const { content, trigger } = response.notification.request;
  const raw = (trigger as { payload?: Record<string, unknown> } | null)?.payload;
  const fromData = (content.data as Record<string, unknown> | null | undefined)?.[key];
  const fromRaw = raw?.[key] ?? (raw?.body as Record<string, unknown> | undefined)?.[key];
  return typeof fromData === 'string' ? fromData : typeof fromRaw === 'string' ? fromRaw : null;
}

export function alertIdOf(response: Notifications.NotificationResponse): string | null {
  const id = pushField(response, 'alertId');
  return id && /^[0-9a-f-]{36}$/i.test(id) ? id : null;
}

/** Where a tap leads: a chat push opens the chat, every other push its alert. */
export type PushTarget = 'alert' | 'chat';

/**
 * A tap on a notification or its „Ich komme" action. The action acknowledges at once (single use on the
 * server, a second tap changes nothing); either way the alert opens. A tap on a chat push (a new
 * message from the person at the vehicle) opens the chat.
 */
export async function handleResponse(
  response: Notifications.NotificationResponse,
  open: (alertId: string, target: PushTarget) => void,
  openVehicle?: (vehicleId: string) => void,
): Promise<'acknowledged' | 'opened' | 'extended' | 'ended' | 'ignored'> {
  const brb = await handleStatusResponse(response, openVehicle);
  if (brb) return brb;
  const alertId = alertIdOf(response);
  if (!alertId) return 'ignored';
  if (response.actionIdentifier === ACK_ACTION) {
    await api(`/v1/app/alerts/${alertId}/ack`, { body: { reply: 'coming' } }).catch(
      () => undefined,
    );
    open(alertId, 'alert');
    return 'acknowledged';
  }
  open(alertId, pushField(response, 'kind') === 'chat' ? 'chat' : 'alert');
  return 'opened';
}

/** The vehicle of a „Bin gleich zurück“ push (pre-expiry or the silent „ended“), else null. */
export function statusPushOf(
  data: Record<string, unknown> | null | undefined,
): { vehicleId: string; kind: 'brb_expiring' | 'brb_ended' } | null {
  const kind = data?.kind;
  const vehicleId = data?.vehicleId;
  if ((kind !== 'brb_expiring' && kind !== 'brb_ended') || typeof vehicleId !== 'string')
    return null;
  return /^[0-9a-f-]{36}$/i.test(vehicleId) ? { vehicleId, kind } : null;
}

/** „+5 Min“ / „Beenden“ on the pre-expiry push, or a tap on it (opens the vehicle). */
async function handleStatusResponse(
  response: Notifications.NotificationResponse,
  openVehicle?: (vehicleId: string) => void,
): Promise<'extended' | 'ended' | 'opened' | null> {
  const kind = pushField(response, 'kind');
  const vehicleId = pushField(response, 'vehicleId');
  const push = statusPushOf({ kind, vehicleId });
  if (!push) return null;
  let result: 'extended' | 'ended' | 'opened' = 'opened';
  if (response.actionIdentifier === BRB_EXTEND_ACTION) {
    await extendStatus(push.vehicleId).catch(() => undefined);
    result = 'extended';
  } else if (response.actionIdentifier === BRB_END_ACTION) {
    await endStatus(push.vehicleId).catch(() => undefined);
    result = 'ended';
  }
  statusChanged(push.vehicleId);
  openVehicle?.(push.vehicleId);
  return result;
}

/**
 * Data-only FCM messages while the app is in the foreground (the silent „Bin gleich zurück ended“).
 * React Native Firebase delivers them; builds without Firebase have none (the banner still ends with
 * its own countdown and on every refetch).
 */
export function onDataMessage(fn: (data: Record<string, unknown>) => void): () => void {
  if (!HAS_FIREBASE) return () => undefined;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const m =
      require('@react-native-firebase/messaging') as typeof import('@react-native-firebase/messaging');
    return m.onMessage(m.getMessaging(), async (msg) => fn(msg.data ?? {}));
  } catch {
    return () => undefined;
  }
}
