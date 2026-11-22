import { isValidVehicleLabel } from '@parkshield/shared';
import { filterText } from '../moderation/text-filter';

/**
 * Part B (2026-11-22): the vehicle label is printed on the personalised sticker, so it must be 2–20
 * characters of letters, numbers, spaces and basic punctuation and pass the bad-word filter (no
 * insults, threats, links, e-mail addresses or phone numbers).
 */
export function vehicleLabelOk(label: string): boolean {
  return isValidVehicleLabel(label) && filterText(label.trim()).ok;
}
