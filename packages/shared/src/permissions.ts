// Code always checks a permission, never a role name (AD-02). Roles are seeded groupings.
export const PERMISSIONS = [
  'customer.read_masked',
  'alerts.read_metadata',
  'pii.decrypt_request',
  'pii.decrypt_approve',
  'abuse.moderate',
  'moderation.review',
  'billing.refund',
  'promo.manage',
  'orders.manage',
  'tokens.manage',
  'partners.manage',
  'dsr.process',
  'settings.edit',
  'audit.read',
  'staff.manage',
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
  fulfillment: ['orders.manage', 'tokens.manage', 'pii.decrypt_request'],
  analyst: [],
  admin: ADMIN,
  superadmin: ['staff.manage', 'audit.read', 'pii.decrypt_approve', 'settings.edit'],
};
