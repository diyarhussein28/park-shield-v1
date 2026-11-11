import 'server-only';
import type { DecalTemplate } from '@parkshield/shared';
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

export interface PushDevice {
  id: string;
  platform: 'ios' | 'android' | 'desktop' | null;
  label: string | null;
  createdAt: string;
  lastOkAt: string | null;
}

export type OrderableChannel = 'webpush' | 'email' | 'whatsapp';

export interface EmergencyContact {
  id: string;
  name: string;
  email: string;
  vehicleId: string | null;
  vehicleNickname: string | null;
  status: 'pending' | 'confirmed' | 'declined' | 'revoked';
  requestedAt: string;
  decidedAt: string | null;
  expiresAt: string | null;
}

export interface EmergencyContactList {
  limit: number;
  ownerName: string | null;
  escalationMinutes: number | null;
  defaultEscalationMinutes: number;
  contacts: EmergencyContact[];
}

export interface ChannelsOverview {
  order: OrderableChannel[];
  email: { address: string };
  push: { publicKey: string; devices: PushDevice[] };
  whatsapp: { phone: string; verifiedAt: string; enabled: boolean } | null;
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
  steps: { email: boolean; channel: boolean; contact: boolean; decal: boolean };
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
    whatsapp: boolean;
    quietHours: number;
    decalTested: boolean;
    switchedOff: string[];
    whatsappUsage: { used: number; limit: number };
  };
}

export interface Usage {
  whatsapp: { used: number; limit: number };
}

export interface Me {
  email: string;
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
}

export type TokenStatus = 'generated' | 'printed' | 'shipped' | 'active' | 'revoked';

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
