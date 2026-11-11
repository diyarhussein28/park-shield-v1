import { describe, expect, it } from 'vitest';
import { ALERT_TYPE_CODES, ALERT_TYPE_DEFAULTS } from './alert-types';
import { PERMISSIONS, ROLE_PERMISSIONS, STAFF_ROLES } from './permissions';

describe('alert type defaults', () => {
  it('cover every code exactly once', () => {
    expect(ALERT_TYPE_DEFAULTS.map((a) => a.code).sort()).toEqual([...ALERT_TYPE_CODES].sort());
  });

  it('match the documented severity and escalation table (01-requirements §1, NT-03)', () => {
    const urgent = ALERT_TYPE_DEFAULTS.filter((a) => a.severity === 'urgent').map((a) => a.code);
    const escalating = ALERT_TYPE_DEFAULTS.filter((a) => a.escalates).map((a) => a.code);
    expect(urgent.sort()).toEqual(['blocking', 'damage', 'towing_risk']);
    expect(escalating.sort()).toEqual(['blocking', 'damage', 'towing_risk', 'window_open']);
  });
});

describe('staff roles', () => {
  it('only reference known permissions', () => {
    for (const role of STAFF_ROLES) {
      for (const p of ROLE_PERMISSIONS[role]) expect(PERMISSIONS).toContain(p);
    }
  });

  it('give support and fulfillment decrypt-request but not decrypt-approve', () => {
    for (const role of ['support', 'fulfillment'] as const) {
      expect(ROLE_PERMISSIONS[role]).toContain('pii.decrypt_request');
      expect(ROLE_PERMISSIONS[role]).not.toContain('pii.decrypt_approve');
    }
  });

  it('keep staff.manage for superadmin only', () => {
    const holders = STAFF_ROLES.filter((r) => ROLE_PERMISSIONS[r].includes('staff.manage'));
    expect(holders).toEqual(['superadmin']);
  });
});
