import * as Notifications from 'expo-notifications';
import { Stack, useRouter, useSegments, type Href } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { AppState } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Loading } from '@/components/ui';
import { AlertsProvider } from '@/lib/alerts-store';
import { AuthProvider, useAuth } from '@/lib/auth';
import { t } from '@/lib/i18n';
import { pt } from '@/lib/portal-i18n';
import { stackOptions } from '@/theme/navigation';
import { useTheme } from '@/theme/tokens';
import { configureNotifications, handleResponse, registerDevice } from '@/lib/push';

/**
 * A deep link or Universal Link that starts the app on a pushed screen (e.g. /app/alerts/<id>) still
 * gets the tabs beneath it, so the back button and the tab bar exist.
 */
export const unstable_settings = { anchor: '(tabs)' };

/** Public routes: everything else needs a session. */
const PUBLIC = new Set(['anmelden', 'app', 'auth']);

function Gate() {
  const c = useTheme();
  const { signedIn } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    void configureNotifications().catch(() => undefined);
  }, []);

  // Not signed in → sign-in; signed in on the sign-in screen → alerts.
  useEffect(() => {
    if (signedIn === undefined) return;
    const first = segments[0] ?? '';
    if (!signedIn && !PUBLIC.has(first)) router.replace('/anmelden');
    // The typed-routes generator of this expo-router version lists the home tab as /index, not /.
    if (signedIn && first === 'anmelden') router.replace('/' as Href);
  }, [signedIn, segments, router]);

  // Every start refreshes the device registration (last seen, token rotation, locale), and so does
  // every return to the foreground: notifications switched on in the iOS settings count at once.
  useEffect(() => {
    if (!signedIn) return;
    void registerDevice().catch(() => false);
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void registerDevice().catch(() => false);
    });
    return () => sub.remove();
  }, [signedIn]);

  // A tap on a notification, or its „Ich komme" action (also when it launched the app).
  useEffect(() => {
    if (!signedIn) return;
    const open = (id: string) => router.push({ pathname: '/alerts/[id]', params: { id } });
    void Notifications.getLastNotificationResponseAsync().then((r) => {
      if (r) {
        void handleResponse(r, open);
        void Notifications.clearLastNotificationResponseAsync();
      }
    });
    const sub = Notifications.addNotificationResponseReceivedListener((r) => {
      void handleResponse(r, open);
    });
    return () => sub.remove();
  }, [signedIn, router]);

  if (signedIn === undefined) return <Loading />;
  return (
    <Stack screenOptions={{ ...stackOptions(c), headerBackTitle: t('back') }}>
      <Stack.Screen name="(tabs)" options={{ headerShown: false, title: t('alertsTitle') }} />
      <Stack.Screen
        name="anmelden"
        options={{ title: t('signInTitle'), headerBackVisible: false }}
      />
      <Stack.Screen
        name="push-erlauben"
        options={{ title: t('pushTitle'), presentation: 'modal' }}
      />
      <Stack.Screen name="alerts/[id]" options={{ title: t('alertTitle') }} />
      <Stack.Screen name="chat/[id]" options={{ title: t('chatTitle') }} />
      <Stack.Screen name="fahrzeug/[id]" options={{ title: pt('portal.vehicles') }} />
      <Stack.Screen name="benachrichtigungen" options={{ title: pt('channels.title') }} />
      <Stack.Screen name="einstellungen" options={{ title: pt('portal.contacts') }} />
      <Stack.Screen name="verlauf" options={{ title: pt('history.title') }} />
      <Stack.Screen name="zustellung" options={{ title: pt('deliveryHelp.title') }} />
      <Stack.Screen name="kuendigen" options={{ title: pt('common.footer.cancelContract') }} />
      <Stack.Screen name="widerrufen" options={{ title: pt('common.footer.withdrawContract') }} />
      <Stack.Screen name="daten" options={{ title: pt('privacy.title') }} />
      <Stack.Screen name="zurueck" options={{ headerShown: false }} />
      <Stack.Screen name="hilfe" options={{ title: t('help') }} />
      <Stack.Screen name="app/anmelden" options={{ headerShown: false }} />
      <Stack.Screen name="app/alerts/[id]" options={{ headerShown: false }} />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <StatusBar style="auto" />
        <AlertsProvider>
          <Gate />
        </AlertsProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
