import { useFonts } from 'expo-font';
import * as Notifications from 'expo-notifications';
import { Stack, usePathname, useRouter, useSegments, type Href } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { LockScreen } from '@/components/lock-screen';
import { Loading } from '@/components/ui';
import { AlertsProvider } from '@/lib/alerts-store';
import { AuthProvider, useAuth } from '@/lib/auth';
import { onLangChange, t, type Lang } from '@/lib/i18n';
import { loadLang } from '@/lib/language';
import { allowedWhileLocked, LockProvider, useLock } from '@/lib/lock';
import { pt } from '@/lib/portal-i18n';
import { getFlag, peekFlag } from '@/lib/prefs';
import { ProfileProvider, useProfile } from '@/lib/profile';
import {
  configureNotifications,
  handleResponse,
  registerDevice,
  type PushTarget,
} from '@/lib/push';
import { stackOptions } from '@/theme/navigation';
import { HEADING_FONT, HEADING_FONT_BOLD, useTheme } from '@/theme/tokens';

/**
 * A deep link or Universal Link that starts the app on a pushed screen (e.g. /app/alerts/<id>) still
 * gets the tabs beneath it, so the back button and the tab bar exist.
 */
export const unstable_settings = { anchor: '(tabs)' };

/** Screens without a session: onboarding, sign-in, sign-up and the link landings. */
const PUBLIC = new Set(['willkommen', 'anmelden', 'registrieren', 'app', 'auth']);
/**
 * Screens reachable while the account is incomplete: the profile (with the phone step) itself, and
 * alerts, their detail and chat (never block those, owner decisions 2026-11-20 and 2026-11-21).
 */
const PROFILE_FREE = new Set(['profil', 'alerts', 'chat', 'app', 'auth']);

/**
 * Where a session-less or half-set-up user belongs, or null to stay. Pure, so the routing rules are
 * unit-tested: no session → onboarding (first launch) or sign-in; signed in without name and address
 * or without a verified mobile number → the profile steps (new sign-up) or the blocking „Konto
 * vervollständigen“ (older accounts); signed in on a public screen → the Face ID offer (when the lock
 * is off) or Start.
 */
export function gateTarget(s: {
  signedIn: boolean;
  first: string;
  onboarded: boolean;
  profileComplete: boolean | undefined;
  /** A verified mobile number exists (required for the escalation SMS); undefined while loading. */
  phoneVerified?: boolean | undefined;
  /** The account never had a contract: name and address are part of its sign-up. */
  newAccount?: boolean;
  lockEnabled: boolean | undefined;
}): Href | null {
  if (!s.signedIn) {
    if (PUBLIC.has(s.first)) return null;
    return s.onboarded ? '/anmelden' : '/willkommen';
  }
  if (s.profileComplete === undefined || s.lockEnabled === undefined) return null;
  // Only a known `false` blocks: a missing answer (offline, older server) never locks the owner out.
  const ready = s.profileComplete && s.phoneVerified !== false;
  if (!ready && !PROFILE_FREE.has(s.first)) {
    const signup = s.first === 'registrieren' || Boolean(s.newAccount);
    return { pathname: '/profil', params: { flow: signup ? 'signup' : 'complete' } };
  }
  if (ready && ['anmelden', 'registrieren', 'willkommen'].includes(s.first)) {
    return s.lockEnabled ? ('/' as Href) : { pathname: '/app-sperre', params: { next: 'home' } };
  }
  return null;
}

function Gate() {
  const c = useTheme();
  const { signedIn } = useAuth();
  const { complete, phoneVerified, newAccount } = useProfile();
  const lock = useLock();
  const segments = useSegments();
  const pathname = usePathname();
  const router = useRouter();
  const [onboarded, setOnboarded] = useState<boolean | undefined>(undefined);

  useEffect(() => {
    void configureNotifications().catch(() => undefined);
    void getFlag('onboarded').then(setOnboarded);
  }, []);

  useEffect(() => {
    if (signedIn === undefined || onboarded === undefined) return;
    const target = gateTarget({
      signedIn,
      first: segments[0] ?? '',
      // Sign-out clears the flag in this run: the next stop is the first onboarding slide.
      onboarded: peekFlag('onboarded') ?? onboarded,
      profileComplete: complete,
      phoneVerified,
      newAccount,
      lockEnabled: lock.enabled,
    });
    if (target) router.replace(target);
  }, [signedIn, onboarded, complete, phoneVerified, newAccount, lock.enabled, segments, router]);

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

  // A tap on a notification, or its „Ich komme" action (also when it launched the app). The alert it
  // belongs to opens even while the app is locked (owner decision 2026-11-20).
  const { allowAlert } = lock;
  useEffect(() => {
    if (!signedIn) return;
    const open = (id: string, target: PushTarget) => {
      allowAlert(id);
      router.push({ pathname: target === 'chat' ? '/chat/[id]' : '/alerts/[id]', params: { id } });
    };
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
  }, [signedIn, router, allowAlert]);

  if (signedIn === undefined || onboarded === undefined) return <Loading />;
  const showLock = Boolean(signedIn) && lock.locked && !allowedWhileLocked(pathname, lock.pass);
  return (
    <>
      <Stack screenOptions={{ ...stackOptions(c), headerBackTitle: t('back') }}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false, title: t('homeTitle') }} />
        <Stack.Screen name="willkommen" options={{ headerShown: false }} />
        {/* The screen carries its own title; the header stays empty (P5). */}
        <Stack.Screen name="anmelden" options={{ title: '', headerBackVisible: false }} />
        <Stack.Screen name="registrieren" options={{ title: '', headerBackVisible: false }} />
        <Stack.Screen name="profil" options={{ title: pt('profile.title') }} />
        <Stack.Screen name="email-aendern" options={{ title: t('emailChangeTitle') }} />
        <Stack.Screen name="nummer-aendern" options={{ title: t('phoneChangeTitle') }} />
        <Stack.Screen name="app-sperre" options={{ title: '' }} />
        <Stack.Screen name="tarif" options={{ title: '' }} />
        <Stack.Screen name="erfolg" options={{ title: '' }} />
        <Stack.Screen name="abo" options={{ title: t('planRow') }} />
        <Stack.Screen name="push-erlauben" options={{ title: '', presentation: 'modal' }} />
        <Stack.Screen name="alerts/[id]" options={{ title: t('alertTitle') }} />
        <Stack.Screen name="chat/[id]" options={{ title: t('chatTitle') }} />
        <Stack.Screen name="fahrzeug/[id]" options={{ title: pt('portal.vehicles') }} />
        <Stack.Screen name="fahrzeug/design/[id]" options={{ title: t('designTitle') }} />
        <Stack.Screen name="fahrzeug/drucken/[id]" options={{ title: t('printTitle') }} />
        <Stack.Screen name="fahrzeug/foto/[id]" options={{ title: t('carPhotoTitle') }} />
        <Stack.Screen name="benachrichtigungen" options={{ title: pt('channels.title') }} />
        <Stack.Screen name="zustellung" options={{ title: pt('deliveryHelp.title') }} />
        <Stack.Screen name="kuendigen" options={{ title: pt('common.footer.cancelContract') }} />
        <Stack.Screen name="widerrufen" options={{ title: pt('common.footer.withdrawContract') }} />
        <Stack.Screen name="daten" options={{ title: pt('privacy.title') }} />
        <Stack.Screen name="zurueck" options={{ headerShown: false }} />
        <Stack.Screen name="hilfe" options={{ title: t('help') }} />
        <Stack.Screen name="app/anmelden" options={{ headerShown: false }} />
        <Stack.Screen name="app/alerts/[id]" options={{ headerShown: false }} />
      </Stack>
      {showLock && <LockScreen />}
    </>
  );
}

export default function RootLayout() {
  // Heading typeface (titles only), bundled; the app starts with the system font if loading fails.
  // German unless this phone saved English (2026-11-22); a switch re-renders every screen.
  const [language, setLanguage] = useState<Lang | null>(null);
  useEffect(() => {
    void loadLang().then(setLanguage);
    return onLangChange(setLanguage);
  }, []);
  const [fontsLoaded, fontError] = useFonts({
    [HEADING_FONT]: require('../../assets/fonts/PlusJakartaSans_800ExtraBold.ttf'),
    [HEADING_FONT_BOLD]: require('../../assets/fonts/PlusJakartaSans_700Bold.ttf'),
  });
  if ((!fontsLoaded && !fontError) || !language) return null;
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <StatusBar style="auto" />
        <ProfileProvider>
          <LockProvider>
            <AlertsProvider>
              <Gate key={language} />
            </AlertsProvider>
          </LockProvider>
        </ProfileProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
