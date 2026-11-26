import type { StatusDuration, StatusPreset } from '@parkshield/shared';
import { api } from './api';

/** „Bin gleich zurück“ as the API returns it (GET/PUT/extend /v1/vehicles/:id/status). */
export interface VehicleStatus {
  presetKey: StatusPreset | null;
  customText: string | null;
  durationMin: number;
  startedAt: string;
  expiresAt: string;
  /** „+5 Min“ still moves the end (below now + 60 min). */
  canExtend: boolean;
  /** Scanners who tapped „Ich warte“ during this status. */
  waitingCount: number;
}

export const getStatus = (vehicleId: string) =>
  api<{ enabled: boolean; status: VehicleStatus | null }>(`/v1/vehicles/${vehicleId}/status`);

export const setStatus = (
  vehicleId: string,
  body: { presetKey: StatusPreset } | { customText: string },
  durationMin: StatusDuration,
) =>
  api<{ status: VehicleStatus }>(`/v1/vehicles/${vehicleId}/status`, {
    method: 'PUT',
    body: { ...body, durationMin },
  }).then((r) => r.status);

export const extendStatus = (vehicleId: string) =>
  api<{ status: VehicleStatus }>(`/v1/vehicles/${vehicleId}/status/extend`, {
    body: { minutes: 5 },
  }).then((r) => r.status);

export const endStatus = (vehicleId: string) =>
  api<{ ok: true }>(`/v1/vehicles/${vehicleId}/status`, { method: 'DELETE' });

/** mm:ss of the time left (never negative). */
export function mmss(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const sec = total % 60;
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

/** Whole minutes left for screen readers (announced once a minute, not every second). */
export const minutesLeftOf = (ms: number) => Math.max(0, Math.ceil(ms / 60_000));

// Every screen that shows a status refetches when one changes elsewhere: a push (pre-expiry, the
// silent „ended“), a notification action („+5 Min“, „Beenden“) or another screen.
const listeners = new Set<(vehicleId: string | null) => void>();
export function onStatusChange(fn: (vehicleId: string | null) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
export function statusChanged(vehicleId: string | null = null): void {
  for (const fn of listeners) fn(vehicleId);
}
