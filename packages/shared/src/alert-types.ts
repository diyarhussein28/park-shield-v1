// Mirrors the alert_types seed in db/migrations. Runtime values come from the DB (editable in ops, AD-14);
// these are the defaults and the type source for the apps.
export const ALERT_TYPE_CODES = [
  'blocking',
  'lights_on',
  'window_open',
  'damage',
  'alarm',
  'towing_risk',
  'custom',
] as const;
export type AlertTypeCode = (typeof ALERT_TYPE_CODES)[number];

export type AlertSeverity = 'info' | 'normal' | 'urgent';

export interface AlertTypeDefault {
  code: AlertTypeCode;
  severity: AlertSeverity;
  escalates: boolean;
  sortOrder: number;
}

export const ALERT_TYPE_DEFAULTS: readonly AlertTypeDefault[] = [
  { code: 'blocking', severity: 'urgent', escalates: true, sortOrder: 1 },
  { code: 'lights_on', severity: 'normal', escalates: false, sortOrder: 2 },
  { code: 'window_open', severity: 'normal', escalates: true, sortOrder: 3 },
  { code: 'damage', severity: 'urgent', escalates: true, sortOrder: 4 },
  { code: 'alarm', severity: 'normal', escalates: false, sortOrder: 5 },
  { code: 'towing_risk', severity: 'urgent', escalates: true, sortOrder: 6 },
  { code: 'custom', severity: 'normal', escalates: false, sortOrder: 7 },
];

export const ALERT_STATUSES = [
  'created',
  'blocked',
  'dispatched',
  'delivered',
  'acknowledged',
  'escalated',
  'expired',
] as const;
export type AlertStatus = (typeof ALERT_STATUSES)[number];

export const OWNER_REPLIES = ['coming', 'in_30_min', 'not_nearby'] as const;
export type OwnerReply = (typeof OWNER_REPLIES)[number];

export const CUSTOM_MESSAGE_MAX = 280;

/** Decal header suggestions (OW-03). Decals are printed in German for the German market. */
export const CTA_SUGGESTIONS = [
  'Kontaktieren Sie mich',
  'Blockiere ich Sie? Bitte scannen',
  'Parke ich falsch? Kurz scannen',
  'Licht an? Bitte scannen',
  'Etwas passiert? Scannen',
] as const;
export const CTA_MAX = 40;

export const DECAL_TEMPLATES = [
  'classic',
  'signal',
  'bold',
  'minimal',
  'night',
  'friendly',
] as const;
export type DecalTemplate = (typeof DECAL_TEMPLATES)[number];

export const DECAL_PRODUCTS = ['uv_vinyl_sticker', 'a6_dashboard_card'] as const;
export type DecalProduct = (typeof DECAL_PRODUCTS)[number];
