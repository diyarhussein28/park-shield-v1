import type { DecalTemplate } from '@parkshield/shared/alert-types';
import { File, Paths } from 'expo-file-system';
import * as Linking from 'expo-linking';
import * as Sharing from 'expo-sharing';
import * as WebBrowser from 'expo-web-browser';
import { ApiError, authHeaders } from './api';
import { API_URL } from './config';
import { pt } from './portal-i18n';

/* The customer portal's data, the same shapes as apps/web/lib/api-server.ts. */

export type OrderableChannel = 'native_push' | 'webpush' | 'email' | 'sms';

export interface PushDevice {
  id: string;
  platform: 'ios' | 'android' | 'desktop' | null;
  label: string | null;
  createdAt: string;
  lastOkAt: string | null;
}

export interface ChannelsOverview {
  order: OrderableChannel[];
  email: { address: string };
  push: { publicKey: string; devices: PushDevice[] };
  app: {
    devices: {
      id: string;
      platform: 'ios' | 'android';
      appVersion: string | null;
      lastSeenAt: string;
    }[];
  };
  sms: { phone: string; verifiedAt: string; enabled: boolean } | null;
  available: { sms: boolean };
}

export interface QuietRule {
  id: string;
  vehicleId: string | null;
  days: number[];
  start: string;
  end: string;
  urgentBypass: boolean;
}
export interface QuietHours {
  timezone: string;
  rules: QuietRule[];
}

export type VehicleModeKind = 'sensitive_spot' | 'short_stop';
export interface VehicleMode {
  mode: VehicleModeKind;
  startsAt: string;
  endsAt: string;
}

export interface Protection {
  percent: number;
  steps: { email: boolean; channel: boolean; contact: boolean | null; decal: boolean };
}

export interface HistoryAlert {
  id: string;
  vehicle: { id: string; nickname: string };
  type: { code: string; de: string; en: string };
  severity: string;
  isTest: boolean;
  status: string;
  ownerReply: 'coming' | 'in_30_min' | 'not_nearby' | null;
  createdAt: string;
  message: string | null;
  muted: 'quiet_hours' | 'sensitive_spot' | null;
  deliveries: { channel: string; status: string; reason: string | null }[];
  reported: boolean;
  canBlock: boolean;
  hiddenContent: boolean;
  verifiedSender: boolean;
  photos?: { count: number; viewPath: string | null };
}

export interface VehicleProtection {
  active: boolean;
  source: 'auto' | 'manual' | null;
  activeUntil: string | null;
}

export interface DeliveryHelp {
  attempts: {
    alertId: string;
    at: string;
    nickname: string;
    type: { de: string; en: string };
    isTest: boolean;
    channel: string;
    status: string;
    reason: string | null;
  }[];
  setup: {
    pushDevices: number;
    pushFailing: number;
    appDevices: number;
    appFailing: number;
    sms: boolean;
    quietHours: number;
    decalTested: boolean;
    switchedOff: string[];
    smsUsage: { used: number; limit: number };
  };
}

export interface Usage {
  sms: { used: number; limit: number };
}

export interface PortalMe {
  email: string;
  customerNo: string | null;
  preferredLang: 'de' | 'en';
  summaryFrequency: 'off' | 'weekly' | 'monthly';
  escalationMinutes: number | null;
  timezone: string;
  passkeys: { id: string; label: string | null; createdAt: string; lastUsedAt: string | null }[];
}

export interface SubscriptionSummary {
  plan: 'plus' | 'premium';
  status: 'active' | 'past_due';
  contractNo: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  canceledAt: string | null;
  interval: 'year' | 'month';
  renewalMode: 'annual' | 'monthly_after_first_term';
  withdrawalOpenUntil: string | null;
}

export type TokenStatus = 'in_stock' | 'assigned' | 'revoked';

export interface PortalVehicle {
  id: string;
  nickname: string;
  plate: string | null;
  makeModel: string | null;
  color: string | null;
  createdAt: string;
  decal: {
    tokenId: string;
    codeHint: string;
    status: TokenStatus;
    cta: string;
    template: DecalTemplate;
    activatedAt: string | null;
    lastTestAt: string | null;
    testWindowUntil: string | null;
  } | null;
}

export interface OrderSummary {
  id: string;
  status:
    | 'pending_payment'
    | 'paid'
    | 'in_production'
    | 'shipped'
    | 'delivered'
    | 'returned'
    | 'canceled'
    | 'refunded';
  included: boolean;
  trackingNumber: string | null;
  createdAt: string;
  product: string;
  vehicleId: string | null;
  nickname: string | null;
}

export interface InvoiceSummary {
  id: string;
  number: string;
  createdAt: string;
  totalCents: number;
  pdfUrl: string | null;
}

export interface CreditNote {
  id: string;
  number: string;
  kind: string;
  amountCents: number;
  createdAt: string;
}

export interface EmergencyContact {
  id: string;
  position: number;
  name: string;
  email: string | null;
  phone: string | null;
  vehicleId: string | null;
  vehicleNickname: string | null;
  status: 'pending' | 'confirmed' | 'declined' | 'revoked' | 'deactivated';
  requestedAt: string;
  decidedAt: string | null;
  expiresAt: string | null;
}

/** The website's errorText (apps/web/lib/api-client.ts): known API errors in plain words. */
export function errorText(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 429) {
      const minutes = Math.max(1, Math.ceil(Number(err.body?.retryAfterSeconds ?? 60) / 60));
      return pt('auth.rateLimited', { minutes });
    }
    if (err.body?.error === 'captcha_failed') return pt('auth.captchaFailed');
    if (err.body?.error === 'promo_invalid') return pt('checkout.promoInvalid');
    if (err.body?.error === 'already_subscribed') return pt('checkout.already');
    if (err.body?.error === 'profile_incomplete') return pt('profile.needed');
  }
  return pt('auth.genericError');
}

export const euro = (cents: number, locale: string) =>
  new Intl.NumberFormat(locale === 'en' ? 'en-IE' : 'de-DE', {
    style: 'currency',
    currency: 'EUR',
  }).format(cents / 100);

/** Where Stripe hands the result back to the app (apps/api/src/billing/app-return.ts). */
export const appReturnUrl = () => Linking.createURL('zurueck');

export interface PayResult {
  result: 'success' | 'canceled' | 'closed';
  sessionId: string | null;
}

/**
 * Paying inside the app: `start` asks the API for the Stripe page with the app's return address, which
 * opens in the in-app browser. Stripe returns through the website's bounce page into the app, and the
 * browser closes by itself. Closing it by hand counts as „closed“ (the caller still re-checks).
 */
export async function payInApp(
  start: (appReturn: string) => Promise<{ url: string }>,
): Promise<PayResult> {
  const back = appReturnUrl();
  const { url } = await start(back);
  const r = await WebBrowser.openAuthSessionAsync(url, back);
  if (r.type !== 'success') return { result: 'closed', sessionId: null };
  const q = Linking.parse(r.url).queryParams ?? {};
  return {
    result: q.result === 'success' ? 'success' : 'canceled',
    sessionId: typeof q.session_id === 'string' ? q.session_id : null,
  };
}

/** Opens a web page (an invoice hosted by Stripe, the photo view page) in the in-app browser. */
export const openInBrowser = (url: string) =>
  WebBrowser.openBrowserAsync(url.startsWith('http') ? url : `${API_URL}${url}`);

/**
 * Downloads a file with the session (credit note, data export, welcome letter) into a temporary file,
 * hands it to the share sheet (save to Files, print, mail) and deletes the temporary file again.
 */
export async function downloadAndShare(
  path: string,
  filename: string,
  mimeType: string,
  method: 'GET' | 'POST' = 'GET',
): Promise<void> {
  if (!(await Sharing.isAvailableAsync())) throw new Error('sharing_unavailable');
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      ...(await authHeaders()),
      ...(method === 'POST' ? { 'content-type': 'application/json' } : {}),
    },
    ...(method === 'POST' ? { body: '{}' } : {}),
  });
  if (!res.ok) {
    let body: { error?: string; [k: string]: unknown } | null = null;
    try {
      body = (await res.json()) as typeof body;
    } catch {
      body = null;
    }
    throw new ApiError(res.status, body);
  }
  const file = new File(Paths.cache, `${Date.now()}-${filename}`);
  try {
    file.write(new Uint8Array(await res.arrayBuffer()));
    await Sharing.shareAsync(file.uri, { mimeType });
  } finally {
    if (file.exists) file.delete();
  }
}
