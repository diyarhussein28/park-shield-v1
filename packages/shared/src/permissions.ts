// Code always checks a permission, never a role name (AD-02). Roles are seeded groupings.
export const PERMISSIONS = [
  'customer.read_masked',
  'customer.manage',
  'alerts.read_metadata',
  'pii.decrypt_request',
  'pii.decrypt_approve',
  'abuse.moderate',
  'moderation.review',
  'billing.refund',
  'promo.manage',
  'orders.manage',
  'tokens.manage',
  // Production export of in-house sticker batches (every code of a batch), 2026-11-27. Admin only.
  'tokens.export',
  'partners.manage',
  'dsr.process',
  'settings.edit',
  'audit.read',
  'staff.manage',
  'letters.print',
  'letters.manage',
  // A new decal code despite the cooldown (support case, e.g. a stolen sticker), 2026-11-24.
  'codes.override_cooldown',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export const STAFF_ROLES = [
  'support',
  'abuse_moderator',
  'finance',
  'fulfillment',
  'analyst',
  'admin',
  'superadmin',
] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

// Reading blocked message content needs the dedicated moderator permission, even for admins (AD-09).
const ADMIN: Permission[] = PERMISSIONS.filter(
  (p) => p !== 'staff.manage' && p !== 'moderation.review',
);

export const ROLE_PERMISSIONS: Record<StaffRole, readonly Permission[]> = {
  support: ['customer.read_masked', 'alerts.read_metadata', 'pii.decrypt_request'],
  abuse_moderator: ['customer.read_masked', 'abuse.moderate', 'moderation.review'],
  finance: ['customer.read_masked', 'billing.refund', 'promo.manage'],
  fulfillment: ['orders.manage', 'tokens.manage', 'pii.decrypt_request', 'letters.print'],
  analyst: [],
  admin: ADMIN,
  superadmin: ['staff.manage', 'audit.read', 'pii.decrypt_approve', 'settings.edit'],
};
