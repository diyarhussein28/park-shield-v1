/** Response shapes of /v1/app/* (apps/api/src/app/app-alerts.service.ts). */
export interface AlertType {
  code: string;
  de: string;
  en: string;
}

export interface AlertListItem {
  id: string;
  type: AlertType;
  severity: 'info' | 'normal' | 'urgent';
  status: string;
  isTest: boolean;
  createdAt: string;
  seenAt: string | null;
  acknowledged: boolean;
  acknowledgedBy: string | null;
  escalationStep: number;
  vehicle: { id: string; nickname: string };
  photoCount: number;
  chatStatus: ChatStatus | null;
}

export interface AlertList {
  alerts: AlertListItem[];
  next: string | null;
  pushReady: boolean;
}

export type ChatStatus = 'locked' | 'active' | 'closed';

export interface ChatMessage {
  id: string;
  from: 'owner' | 'scanner';
  text: string;
  at: string;
}

export interface ChatState {
  status: ChatStatus;
  openedAt: string | null;
  closedAt: string | null;
  closeReason: 'owner' | 'inactivity' | 'max_duration' | 'alert_deleted' | null;
  purged: boolean;
  /** Messages this side may still send; null = no limit (the owner, unless ops sets one). */
  remaining: number | null;
  limits: {
    maxChars: number;
    /** The person at the vehicle's limit. */
    maxPerSide: number;
    /** The owner's limit; 0 = none. */
    maxOwnerMessages?: number;
    inactivityMinutes: number;
    maxMinutes: number;
  };
  scanner: { online: boolean; lastSeenAt: string | null };
  readByOther: string | null;
  messages: ChatMessage[];
  quickReplies?: string[];
}

export interface AlertDetail {
  id: string;
  type: AlertType;
  severity: string;
  status: string;
  isTest: boolean;
  createdAt: string;
  expiresAt: string;
  seenAt: string | null;
  reply: 'coming' | 'in_30_min' | 'not_nearby' | null;
  acknowledgedAt: string | null;
  acknowledgedBy: { kind: 'owner' | 'contact'; name: string | null } | null;
  escalation: {
    applies: boolean;
    step: number;
    escalatedAt: string | null;
    notified: { step: number | null; name: string | null }[];
  };
  vehicle: { id: string; nickname: string };
  contentHidden: boolean;
  revealed: boolean;
  message: string | null;
  photos: { id: string; position: number; width: number; height: number }[];
  photoCount: number;
  /** Why the alert has no photos any more: an abuse report or the 30-day deletion. */
  photosGone: 'abuse_report' | 'retention' | null;
  /** „Missbrauch melden“ was used for this alert (here, on the website or from the e-mail link). */
  reported: boolean;
  chat: (ChatState & { canOpen: boolean; senderBlocked: boolean }) | null;
}

export interface EscalationSettings {
  available: boolean;
  enabled: boolean;
  delayMinutes: number;
  confirmedContacts: number;
  suggestEnable: boolean;
  vehicles: { id: string; nickname: string; enabled: boolean | null }[];
}

export interface Contact {
  id: string;
  position: number;
  name: string;
  email: string | null;
  phone: string | null;
  status: 'pending' | 'confirmed' | 'declined' | 'revoked' | 'deactivated';
  expiresAt: string | null;
}

export interface ContactList {
  premium: boolean;
  limit: number;
  ownerName: string | null;
  contacts: Contact[];
}

export interface Me {
  email: string;
  customerNo: string | null;
  preferredLang: 'de' | 'en';
  plan?: 'plus' | 'premium' | null;
}
