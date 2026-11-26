/**
 * „Bin gleich zurück“ / "Be right back" (owner spec 2026-11-26, `docs/vehicle-status.md`): a short,
 * temporary status message per vehicle that the scan page shows first. Presets are stored as keys and
 * rendered in the reader's language (texts in `packages/i18n`, scanner namespace `brbPreset_<KEY>`);
 * a custom message is shown exactly as written, as plain text. The API validates authoritatively with
 * `checkStatusText`; the app runs the same function for the live hint.
 */
export const STATUS_PRESETS = ['BACK_FEW_MIN', 'PLEASE_WAIT', 'QUICK_ERRAND', 'LOADING'] as const;
export type StatusPreset = (typeof STATUS_PRESETS)[number];

export const STATUS_DURATIONS = [5, 10, 15, 30, 60] as const;
export type StatusDuration = (typeof STATUS_DURATIONS)[number];
export const STATUS_DEFAULT_DURATION: StatusDuration = 10;
/** expires_at is never more than this far ahead, also after „+5 Min“. */
export const STATUS_MAX_MINUTES = 60;
export const STATUS_EXTEND_MINUTES = 5;
/** Grapheme clusters (what a person counts as characters). */
export const STATUS_TEXT_MAX = 150;
export const STATUS_MAX_LINE_BREAKS = 2;

export type StatusTextError = 'empty' | 'too_long' | 'too_many_lines' | 'contact_data';

/** Grapheme clusters where the engine has Intl.Segmenter, else code points (never fewer graphemes). */
export function graphemeCount(text: string): number {
  const Seg = (Intl as unknown as { Segmenter?: new (l?: string, o?: object) => Segmenter })
    .Segmenter;
  if (Seg) {
    let n = 0;
    for (const _ of new Seg(undefined, { granularity: 'grapheme' }).segment(text)) n++;
    return n;
  }
  return Array.from(text).length;
}
interface Segmenter {
  segment(text: string): Iterable<unknown>;
}

/**
 * Trim, collapse repeated spaces and tabs inside a line, drop empty lines beyond the allowed line
 * breaks' worth and normalise line endings. What is stored and shown is exactly this result.
 */
export function normalizeStatusText(raw: string): string {
  return raw
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[^\S\n]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

// Contact data a stranger must never get from the decal: phone numbers (6+ digits, also written with
// +, spaces, -, /, ( ) or dots between them), e-mail addresses, links and domains, @handles.
const PHONE = /(?:\+|\(|\b)\d(?:[\s\-/().]*\d){5,}/u;
const EMAIL = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}/u;
const URL_LIKE =
  /\b(?:https?:\/\/|www\.)|\b[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)*\.(?:de|com|net|org|info|eu|io|me|app|at|ch|co|biz|online|shop|link|ly|to|tv|xyz|site)\b/iu;
const HANDLE = /(?:^|[^\p{L}\p{N}])@[\p{L}\p{N}_.]{2,}/u;

export function containsContactData(text: string): boolean {
  return PHONE.test(text) || EMAIL.test(text) || URL_LIKE.test(text) || HANDLE.test(text);
}

/** null when the (already normalised) custom message may be stored, else why not. */
export function checkStatusText(text: string): StatusTextError | null {
  if (!text) return 'empty';
  if ((text.match(/\n/g) ?? []).length > STATUS_MAX_LINE_BREAKS) return 'too_many_lines';
  if (graphemeCount(text) > STATUS_TEXT_MAX) return 'too_long';
  if (containsContactData(text)) return 'contact_data';
  return null;
}

/** Minutes left as the scan page says it („Zurück in ca. X Min“): at least 1, rounded up. */
export function minutesLeft(expiresAt: Date | string, now: Date = new Date()): number {
  const ms = new Date(expiresAt).getTime() - now.getTime();
  return Math.max(1, Math.ceil(ms / 60_000));
}
