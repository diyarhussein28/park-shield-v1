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
/** iOS asks with this text before Face ID is used for the app lock (German, the source language). */
const FACE_ID_TEXT =
  'ParkShield nutzt Face ID nur, um die App auf diesem Gerät zu entsperren. Ihr Gesicht verlässt das Gerät nie.';

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'ParkShield',
  slug: 'parkshield',
  // EAS (builds, secrets, registered devices) belongs to the team account, not a personal one.
  owner: 'and2rows-team',
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
      // App lock (docs/app-redesign.md §6). TODO [LEGAL REVIEW] wording with the privacy labels.
      NSFaceIDUsageDescription: FACE_ID_TEXT,
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
    // The heading typeface, embedded in the native build (Expo Go loads it at start instead).
    [
      'expo-font',
      {
        fonts: [
          './assets/fonts/PlusJakartaSans_800ExtraBold.ttf',
          './assets/fonts/PlusJakartaSans_700Bold.ttf',
        ],
      },
    ],
    ['expo-local-authentication', { faceIDPermission: FACE_ID_TEXT }],
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
    // The car photo on Start (Stage 4.2): picked from the library, kept on the device only, never
    // uploaded. No camera, no microphone.
    [
      'expo-image-picker',
      {
        photosPermission:
          'ParkShield zeigt ein Foto Ihres Autos auf der Startseite. Das Foto bleibt nur auf diesem Gerät und wird nie hochgeladen.',
        cameraPermission: false,
        microphonePermission: false,
      },
    ],
    // React Native Firebase 27 resolves the Firebase iOS SDK through Swift Package Manager, which
    // only links with dynamic frameworks (static: duplicate symbols; `pod install` refuses it,
    // https://rnfirebase.io/ios-spm). Expo keeps its own modules static by itself.
    ['expo-build-properties', { ios: { useFrameworks: 'dynamic' } }],
    ...(hasFirebase ? ['@react-native-firebase/app', '@react-native-firebase/messaging'] : []),
  ],
  experiments: { typedRoutes: true },
  extra: {
    apiUrl: process.env.EXPO_PUBLIC_API_URL ?? `https://${DOMAIN}`,
    firebase: hasFirebase,
    // https://expo.dev/accounts/and2rows-team/projects/parkshield
    eas: { projectId: '08d05adb-c016-49c3-b5d0-2cac2ca431f9' },
  },
});
