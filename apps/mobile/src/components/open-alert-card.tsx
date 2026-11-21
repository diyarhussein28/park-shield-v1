import { lang } from '@/lib/i18n';
import type { AlertListItem } from '@/lib/types';

/** German „…“, English “…”. */
export const quoted = (s: string) => (lang() === 'en' ? `“${s}”` : `„${s}“`);

/**
 * Open = the owner has not answered „Ich komme“ and it has not expired (seen alone is still open).
 * The open-alert cards on Start were removed in Stage 4.1: alerts live in the Warnungen tab only.
 */
export const isOpen = (a: AlertListItem) => !a.acknowledged && a.status !== 'expired';
