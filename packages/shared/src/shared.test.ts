import { LIFETIME_PRICE_CENTS, lifetimeCheaperFromYear, yearlyTotalCents } from './plans';
import { describe, expect, it } from 'vitest';
import { ALERT_TYPE_CODES, ALERT_TYPE_DEFAULTS } from './alert-types';
import { PERMISSIONS, ROLE_PERMISSIONS, STAFF_ROLES } from './permissions';
import { isValidVehicleLabel } from './vehicle-label';

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

describe('vehicle label', () => {
  it('accepts 2–20 letters, numbers, spaces and basic punctuation', () => {
    for (const ok of ['Dodo', 'VW Bus', 'Mamas Auto!', 'Ölfass 2', "Kim's Car", 'A1']) {
      expect(isValidVehicleLabel(ok)).toBe(true);
    }
  });

  it('rejects empty, too short, too long and symbols', () => {
    for (const bad of ['', ' ', 'A', 'x'.repeat(21), 'Dodo <3', 'a@b', 'https://x.de/']) {
      expect(isValidVehicleLabel(bad)).toBe(false);
    }
  });
});

describe('„Bin gleich zurück“ text rules', () => {
  it('normalises whitespace and counts grapheme clusters', async () => {
    const { normalizeStatusText, graphemeCount, checkStatusText } =
      await import('./vehicle-status');
    expect(normalizeStatusText('  Bin   gleich\t da \r\n\r\n\n zurück  ')).toBe(
      'Bin gleich da\nzurück',
    );
    expect(graphemeCount('👨‍👩‍👧é')).toBe(2);
    expect(checkStatusText('x'.repeat(150))).toBeNull();
    expect(checkStatusText('x'.repeat(151))).toBe('too_long');
    expect(checkStatusText('a\nb\nc')).toBeNull();
    expect(checkStatusText('a\nb\nc\nd')).toBe('too_many_lines');
  });

  it('rejects phone numbers, e-mail addresses, links, domains and handles', async () => {
    const { checkStatusText } = await import('./vehicle-status');
    for (const bad of [
      '0171 2345678',
      '+49 171 2345678',
      '(0221) 12-34-56',
      '0221/123456',
      'max.muster@web.de',
      'http://x.y',
      'www.beispiel.net',
      'beispiel.com',
      'Ruf an @muster',
    ])
      expect(checkStatusText(bad), bad).toBe('contact_data');
    for (const ok of [
      'Bin in 5 Min zurück',
      'Lade 2 Kisten aus, Tor 3',
      'Zurück um 14:30',
      'Danke fürs Warten :)',
    ])
      expect(checkStatusText(ok), ok).toBeNull();
  });
});

describe('lifetime plan comparison (2026-11-26)', () => {
  it('names the year from which paying once is cheaper, and the 5-year total', () => {
    expect(lifetimeCheaperFromYear(1999, 2999)).toBe(2);
    expect(lifetimeCheaperFromYear(1999, 3998)).toBe(3); // exactly two years is not cheaper yet
    expect(lifetimeCheaperFromYear(1999, 4999)).toBe(3);
    expect(yearlyTotalCents(5, 1999) - LIFETIME_PRICE_CENTS).toBe(6996);
  });
});
