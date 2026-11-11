import { SetMetadata } from '@nestjs/common';

export const OPS_ACCESS = 'opsAccess';

export type OpsAccess =
  { kind: 'public' } | { kind: 'staff' } | { kind: 'permission'; permissions: string[] };

/**
 * Every api-ops endpoint declares exactly one access policy (US-34). StaffGuard denies anything
 * without one, and ops.test.ts fails CI when a route has none.
 *
 * - OpsPublic: health and the sign-in flow only (allow-listed in the test).
 * - StaffOnly: any signed-in staff member (own profile, logout).
 * - RequirePermission: the code checks permissions, never role names (AD-02).
 */
export const OpsPublic = () => SetMetadata(OPS_ACCESS, { kind: 'public' } satisfies OpsAccess);
export const StaffOnly = () => SetMetadata(OPS_ACCESS, { kind: 'staff' } satisfies OpsAccess);
export const RequirePermission = (...permissions: [string, ...string[]]) =>
  SetMetadata(OPS_ACCESS, { kind: 'permission', permissions } satisfies OpsAccess);

export const OPS_SESSION_COOKIE = 'ps_ops_session';
export const OPS_CSRF_COOKIE = 'ps_ops_csrf';
export const OPS_CSRF_HEADER = 'x-csrf-token';
/** AD-01: a staff session ends after 30 minutes without a request, and after 12 hours at most. */
export const STAFF_IDLE_MINUTES = 30;
export const STAFF_MAX_HOURS = 12;
