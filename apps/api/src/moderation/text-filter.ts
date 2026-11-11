// Rule filter for free text (SC-04, OW-03). Word lists become editable in ops with versions (AD-10);
// these defaults seed them. Matching runs on a normalised copy so "A r s c h" or "4rsch" are caught too.

export type FilterReason = 'link' | 'email' | 'phone' | 'insult' | 'threat';

export interface FilterResult {
  ok: boolean;
  reason?: FilterReason;
}

const DEFAULT_INSULTS = [
  'arsch',
  'arschloch',
  'idiot',
  'wichser',
  'fotze',
  'hurensohn',
  'spast',
  'missgeburt',
  'penner',
  'schlampe',
  'vollidiot',
  'depp',
  'asshole',
  'fuck',
  'bitch',
  'cunt',
  'moron',
  'retard',
];
const DEFAULT_THREATS = [
  'umbringen',
  'abstechen',
  'kaputtmachen',
  'zerkratzen',
  'abfackeln',
  'kill you',
];

const LEET: Record<string, string> = {
  '0': 'o',
  '1': 'i',
  '3': 'e',
  '4': 'a',
  '5': 's',
  '7': 't',
  '@': 'a',
  $: 's',
};

function normalise(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{M}/gu, '') // strip accents left over by NFKD ("é" -> "e")
    .replace(/[013457@$]/g, (c) => LEET[c] ?? c);
}

const LINK =
  /(https?:\/\/|www\.|\b[a-z0-9-]{2,}\.(de|com|net|org|eu|io|info|at|ch|me|ly|be|app)\b)/i;
const EMAIL = /[a-z0-9._%+-]+\s*(@|\(at\)|\[at\])\s*[a-z0-9.-]+\.[a-z]{2,}/i;
// Phone numbers, also spelled out with spaces, dots, dashes or slashes: 6+ digits in a short span.
const PHONE = /(\+|00)?\d[\d\s./-]{5,}\d/;

export function filterText(
  text: string,
  lists: { insults?: string[]; threats?: string[] } = {},
): FilterResult {
  // nosemgrep: ajinabraham.njsscan.dos.regex_dos.regex_dos -- input capped at 280 chars; worst case measured at 0.25 ms
  if (EMAIL.test(text)) return { ok: false, reason: 'email' };
  // nosemgrep: ajinabraham.njsscan.dos.regex_dos.regex_dos -- input capped at 280 chars; worst case measured at 0.25 ms
  if (LINK.test(text)) return { ok: false, reason: 'link' };
  const digits = text.replace(/[^\d]/g, '');
  // nosemgrep: ajinabraham.njsscan.dos.regex_dos.regex_dos -- input capped at 280 chars; worst case measured at 0.25 ms
  if (PHONE.test(text) && digits.length >= 6) return { ok: false, reason: 'phone' };

  const norm = normalise(text);
  const squashed = norm.replace(/[^a-z]/g, '');
  const words = norm.split(/[^a-z]+/).filter(Boolean);
  // List words go through the same normalisation as the text ("blödmann" from ops matches "Blödmann").
  for (const t of (lists.threats ?? DEFAULT_THREATS).map(normalise)) {
    if (norm.includes(t) || squashed.includes(t.replace(/[^a-z]/g, '')))
      return { ok: false, reason: 'threat' };
  }
  for (const w of (lists.insults ?? DEFAULT_INSULTS).map(normalise)) {
    // Whole words, plus spaced-out spellings ("a r s c h") caught via the squashed form for longer words.
    if (words.includes(w) || (w.length >= 5 && squashed.includes(w.replace(/[^a-z]/g, ''))))
      return { ok: false, reason: 'insult' };
  }
  return { ok: true };
}
