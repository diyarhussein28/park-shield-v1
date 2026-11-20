import { existsSync } from 'node:fs';
import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * ParkShield app (iOS + Android), Expo SDK 58, Continuous Native Generation (no ios/ or android/ in
 * git). Push goes through Firebase Cloud Messaging (iOS through APNs via FCM), so a development or
 * store build is needed for push; Expo Go shows the UI only.
 *
 * Environment (EAS secrets or a local .env):
 *   EXPO_PUBLIC_API_URL   API origin, default https://park-shield.de (local: http://<LAN-IP>:3000)
 *   GOOGLE_SERVICES_JSON  path to google-services.json (Android FCM), default ./firebase/google-services.json
 *   GOOGLE_SERVICE_PLIST  path to GoogleService-Info.plist (iOS), default ./firebase/GoogleService-Info.plist
 *
 * No analytics or advertising SDKs. TODO [LEGAL REVIEW] App Store / Play Store privacy labels.
 */
const androidFirebase = process.env.GOOGLE_SERVICES_JSON ?? './firebase/google-services.json';
const iosFirebase = process.env.GOOGLE_SERVICE_PLIST ?? './firebase/GoogleService-Info.plist';
const hasFirebase = existsSync(androidFirebase) || existsSync(iosFirebase);
const DOMAIN = 'park-shield.de';

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'ParkShield',
  slug: 'parkshield',
  version: '1.0.0',
  orientation: 'portrait',
  icon: './assets/icon.png',
  scheme: 'parkshield',
  userInterfaceStyle: 'automatic',
  ios: {
    bundleIdentifier: 'de.parkshield.app',
    supportsTablet: false,
    // Universal Links: alert links and the app's sign-in link open the app (AASA on the website).
    associatedDomains: [`applinks:${DOMAIN}`],
    ...(existsSync(iosFirebase) ? { googleServicesFile: iosFirebase } : {}),
    infoPlist: {
      // Photos are saved to the gallery only on the owner's explicit "Speichern".
      NSPhotoLibraryAddUsageDescription:
        'ParkShield speichert ein Foto zu einer Warnung nur, wenn Sie auf „Speichern“ tippen.',
      ITSAppUsesNonExemptEncryption: false,
    },
    entitlements: {
      // Time-sensitive notifications break through Focus modes (no Critical Alerts: those need a
      // special Apple entitlement and are not used).
      'com.apple.developer.usernotifications.time-sensitive': true,
    },
  },
  android: {
    package: 'de.parkshield.app',
    adaptiveIcon: {
      backgroundColor: '#1D4ED8',
      foregroundImage: './assets/android-icon-foreground.png',
      backgroundImage: './assets/android-icon-background.png',
      monochromeImage: './assets/android-icon-monochrome.png',
    },
    ...(existsSync(androidFirebase) ? { googleServicesFile: androidFirebase } : {}),
    // App Links (verified via assetlinks.json on the website).
    intentFilters: [
      {
        action: 'VIEW',
        autoVerify: true,
        data: [{ scheme: 'https', host: DOMAIN, pathPrefix: '/app' }],
        category: ['BROWSABLE', 'DEFAULT'],
      },
    ],
    permissions: ['POST_NOTIFICATIONS'],
    blockedPermissions: [
      'android.permission.READ_PHONE_STATE',
      'com.google.android.gms.permission.AD_ID',
    ],
    predictiveBackGestureEnabled: false,
  },
  plugins: [
    'expo-router',
    'expo-status-bar',
    'expo-secure-store',
    'expo-image',
    [
      'expo-notifications',
      { color: '#1D4ED8', defaultChannel: 'alerts', enableBackgroundRemoteNotifications: false },
    ],
    [
      'expo-media-library',
      {
        savePhotosPermission:
          'ParkShield speichert ein Foto zu einer Warnung nur, wenn Sie auf „Speichern“ tippen.',
        isAccessMediaLocationEnabled: false,
      },
    ],
    // React Native Firebase on iOS needs static frameworks.
    ['expo-build-properties', { ios: { useFrameworks: 'static' } }],
    ...(hasFirebase ? ['@react-native-firebase/app', '@react-native-firebase/messaging'] : []),
  ],
  experiments: { typedRoutes: true },
  extra: {
    apiUrl: process.env.EXPO_PUBLIC_API_URL ?? `https://${DOMAIN}`,
    firebase: hasFirebase,
  },
});
