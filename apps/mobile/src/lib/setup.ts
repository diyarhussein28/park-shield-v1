import type { Href } from 'expo-router';
import { t } from './i18n';
import type { PortalVehicle, Protection } from './portal';
import { pt } from './portal-i18n';

export interface SetupStep {
  key: 'vehicle' | 'channel' | 'phone' | 'decal';
  done: boolean;
  title: string;
  go: string;
  href: Href;
}

/**
 * The real set-up steps (OW-14), counted the same everywhere (P11): vehicle with QR code, the app
 * connected for notifications, the verified mobile number (the SMS after 30 minutes) and the decal
 * tested on the car. One plan, so every step counts.
 */
export function setupSteps(protection: Protection, vehicles: PortalVehicle[]): SetupStep[] {
  const first = vehicles[0] ?? null;
  return [
    {
      key: 'vehicle',
      done: vehicles.length > 0,
      title: pt('setup.vehicleTitle'),
      go: pt('portal.createQr'),
      href: '/fahrzeuge',
    },
    {
      key: 'channel',
      done: protection.steps.channel,
      title: pt('protection.stepChannel'),
      go: pt('protection.goChannel'),
      href: '/benachrichtigungen',
    },
    {
      key: 'phone',
      done: protection.steps.phone,
      title: t('setupPhone'),
      go: t('helpPhoneFix'),
      href: '/benachrichtigungen',
    },
    {
      key: 'decal',
      done: protection.steps.decal,
      title: pt('protection.stepDecal'),
      go: pt('protection.goDecal'),
      href: first ? { pathname: '/fahrzeug/[id]', params: { id: first.id } } : '/fahrzeuge',
    },
  ];
}

export function setupSummary(steps: SetupStep[]) {
  const left = steps.filter((s) => !s.done).length;
  return {
    done: steps.length - left,
    total: steps.length,
    left,
    complete: left === 0,
    next: steps.find((s) => !s.done) ?? null,
  };
}
