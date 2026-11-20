import type { Href } from 'expo-router';
import type { PortalVehicle, Protection } from './portal';
import { pt } from './portal-i18n';

export interface SetupStep {
  key: 'vehicle' | 'channel' | 'decal' | 'contact';
  done: boolean;
  title: string;
  go: string;
  href: Href;
  optional?: boolean;
}

/**
 * The real set-up steps (OW-14), counted the same everywhere (P11): vehicle with QR code, a way to
 * reach the owner, the decal tested on the car, and (PREMIUM only, optional) a trusted contact.
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
      key: 'decal',
      done: protection.steps.decal,
      title: pt('protection.stepDecal'),
      go: pt('protection.goDecal'),
      href: first ? { pathname: '/fahrzeug/[id]', params: { id: first.id } } : '/fahrzeuge',
    },
    ...(protection.steps.contact === null
      ? []
      : [
          {
            key: 'contact' as const,
            done: protection.steps.contact,
            title: pt('protection.stepContact'),
            go: pt('protection.goContact'),
            href: '/einstellungen' as Href,
            optional: true,
          },
        ]),
  ];
}

/** Required steps decide „Geschützt“; the optional contact never blocks it. */
export function setupSummary(steps: SetupStep[]) {
  const required = steps.filter((s) => !s.optional);
  const left = required.filter((s) => !s.done).length;
  return {
    done: steps.filter((s) => s.done).length,
    total: steps.length,
    left,
    complete: left === 0,
    next: steps.find((s) => !s.done) ?? null,
  };
}
