import 'server-only';
import { DEFAULT_LEGAL_CONTEXT, type DecalTemplate, type LegalContext } from '@parkshield/shared';
import { cookies } from 'next/headers';

const API = process.env.API_INTERNAL_URL ?? 'http://127.0.0.1:4000';

/** Server-side API call on behalf of the visitor (forwards their cookies; never cached). */
export async function serverApi<T>(path: string): Promise<{ status: number; data: T | null }> {
  const cookie = (await cookies()).toString();
  try {
    const res = await fetch(`${API}${path}`, {
      headers: cookie ? { cookie } : {},
      cache: 'no-store',
    });
    return { status: res.status, data: res.ok ? ((await res.json()) as T) : null };
  } catch {
    return { status: 503, data: null };
  }
}

/**
 * Runtime legal settings (renewal rule) for the AGB, the withdrawal policy and the checkout. Public and
 * cached for a few minutes; without the API (website preview) the default rule is shown.
 */
export async function legalContext(): Promise<LegalContext> {
  try {
    const res = await fetch(`${API}/v1/legal/context`, { next: { revalidate: 300 } });
    if (res.ok) return (await res.json()) as LegalContext;
  } catch {
    // fall through to the default
  }
  return DEFAULT_LEGAL_CONTEXT;
}

export interface PushDevice {
  id: string;
  platform: 'ios' | 'android' | 'desktop' | null;
  label: string | null;
  createdAt: string;
  lastOkAt: string | null;
}

export interface ChannelsOverview {
  email: { address: string };
  /** Browser push devices from before 2026-11-21; alerts no longer use web push. */
  push: { publicKey: string; devices: PushDevice[] };
  /** Devices of the native app (managed by the app: registered at sign-in, removed at sign-out). */
  app: {
    devices: {
      id: string;
      platform: 'ios' | 'android';
      appVersion: string | null;
      lastSeenAt: string;
    }[];
  };
  sms: { phone: string; verifiedAt: string; enabled: boolean } | null;
  /** Channels that can be set up right now (kill switches). */
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
  /** channel = app push set up, phone = mobile number verified (escalation SMS). */
  steps: { email: boolean; channel: boolean; phone: boolean; decal: boolean };
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
  /** Protected Mode: free text of an unconfirmed sender, shown only on request. */
  hiddenContent: boolean;
  verifiedSender: boolean;
  /** Phase 2: photos that still exist and the alert's view page (valid 30 days). */
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
  sms: { used: number; limit: number; capReached?: boolean };
}

/** GET /v1/me/profile: name and address, and the verified mobile number (required since 2026-11-21). */
export interface ProfileSummary {
  email: string;
  complete: boolean;
  newAccount: boolean;
  /** Masked, e.g. +49 151 ••• 89. */
  phone: string | null;
  phoneVerified: boolean;
}

/** GET /v1/vehicles/:id/print-options: both prices before the owner confirms. */
export interface PrintOptions {
  selfPrint: { priceCents: number };
  shipped: { priceCents: number; free: boolean; welcomePrint: boolean };
}

export interface Me {
  email: string;
  preferredLang: 'de' | 'en';
  summaryFrequency: 'off' | 'weekly' | 'monthly';
  timezone: string;
  passkeys: { id: string; label: string | null; createdAt: string; lastUsedAt: string | null }[];
}

export interface SubscriptionSummary {
  plan: 'standard';
  status: 'active' | 'past_due';
  contractNo: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  canceledAt: string | null;
  interval: 'year' | 'month';
  renewalMode: 'annual' | 'monthly_after_first_term';
  /** § 356a BGB: set while the contract can still be withdrawn. */
  withdrawalOpenUntil: string | null;
}

/** Tag lifecycle: assigned codes work as soon as the sticker is on the car. */
export type TokenStatus = 'in_stock' | 'assigned' | 'revoked';

export interface Vehicle {
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

/** US-40: credit note (Gutschrift) for a refund. */
export interface CreditNote {
  id: string;
  number: string;
  kind: string;
  amountCents: number;
  createdAt: string;
}
