import * as LocalAuthentication from 'expo-local-authentication';
import { Platform } from 'react-native';
import { t } from './i18n';

export type BiometricKind = 'faceId' | 'touchId' | 'fingerprint' | 'face' | 'deviceCode';

export interface BiometricInfo {
  /** The device can lock the app at all (biometrics or at least a device passcode). */
  available: boolean;
  kind: BiometricKind;
}

/** What the device offers, named the way the platform names it (Face ID, Touch ID, Fingerabdruck …). */
export async function biometricInfo(): Promise<BiometricInfo> {
  try {
    const [hardware, enrolled, types, level] = await Promise.all([
      LocalAuthentication.hasHardwareAsync(),
      LocalAuthentication.isEnrolledAsync(),
      LocalAuthentication.supportedAuthenticationTypesAsync(),
      LocalAuthentication.getEnrolledLevelAsync(),
    ]);
    const face = types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION);
    const finger = types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT);
    const ios = Platform.OS === 'ios';
    const kind: BiometricKind =
      hardware && enrolled
        ? face
          ? ios
            ? 'faceId'
            : 'face'
          : finger
            ? ios
              ? 'touchId'
              : 'fingerprint'
            : 'deviceCode'
        : 'deviceCode';
    return { available: level !== LocalAuthentication.SecurityLevel.NONE, kind };
  } catch {
    return { available: false, kind: 'deviceCode' };
  }
}

export const biometricName = (kind: BiometricKind) =>
  t(
    (
      {
        faceId: 'bioFaceId',
        touchId: 'bioTouchId',
        fingerprint: 'bioFingerprint',
        face: 'bioFace',
        deviceCode: 'bioDeviceCode',
      } as const
    )[kind],
  );

/**
 * Face ID / fingerprint, with the device passcode, PIN or pattern as fallback (owner decision
 * 2026-11-20): never an e-mail sign-in just to unlock.
 */
export async function unlock(): Promise<boolean> {
  try {
    const r = await LocalAuthentication.authenticateAsync({
      promptMessage: t('lockPrompt'),
      cancelLabel: t('lockCancel'),
      disableDeviceFallback: false,
    });
    return r.success;
  } catch {
    return false;
  }
}
