import { existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Shared by every PDF we render (contract confirmation, welcome letter, QR exports): the brand mark,
 * the heading font and the WinAnsi filter for the built-in Helvetica.
 */

const PT = 72 / 25.4;

/** Plus Jakarta Sans (OFL) in `apps/api/assets/fonts`; the Dockerfile copies it. */
export const FONT_DIR = join(__dirname, '..', '..', 'assets', 'fonts');

/**
 * Registers the heading fonts on a document. Returns the font names to use; Helvetica-Bold when the
 * files are missing (then every heading must go through `winAnsi`, see `hasFonts`).
 */
export function headingFonts(doc: PDFKit.PDFDocument): {
  bold: string;
  extra: string;
  hasFonts: boolean;
} {
  const hasFonts = existsSync(join(FONT_DIR, 'PlusJakartaSans_800ExtraBold.ttf'));
  if (!hasFonts) return { bold: 'Helvetica-Bold', extra: 'Helvetica-Bold', hasFonts };
  doc.registerFont('PS-Heading', join(FONT_DIR, 'PlusJakartaSans_700Bold.ttf'));
  doc.registerFont('PS-HeadingX', join(FONT_DIR, 'PlusJakartaSans_800ExtraBold.ttf'));
  return { bold: 'PS-Heading', extra: 'PS-HeadingX', hasFonts };
}

/** The ParkShield mark as on the website and in the app (`LogoMark`), drawn as vectors. */
export function drawLogoMark(doc: PDFKit.PDFDocument, x: number, y: number, size: number) {
  doc.save();
  doc.translate(x, y).scale(size / 32);
  const grad = doc.linearGradient(0, 0, 32, 32).stop(0, '#3b82f6').stop(1, '#1d4ed8');
  doc.path('M16 2 4 6.5v8.6C4 22.4 9.1 28.2 16 30c6.9-1.8 12-7.6 12-14.9V6.5L16 2Z').fill(grad);
  doc.roundedRect(10, 10, 5, 5, 1).fill('#ffffff');
  doc.roundedRect(17, 10, 5, 5, 1).fill('#facc15');
  doc.roundedRect(10, 17, 5, 5, 1).fill('#ffffff');
  doc.rect(17.5, 17.5, 2, 2).fill('#ffffff');
  doc.rect(20.5, 20.5, 2, 2).fill('#ffffff');
  doc.restore();
}

/** Points per millimetre. */
export const mm = (v: number) => v * PT;

// Characters outside WinAnsi (the encoding of the built-in Helvetica) fall back to their base
// letter (ş → s, ł → l), so a name never prints as garbage. No external font, no CDN.
const WIN_ANSI_EXTRA = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ';
const FALLBACK: Record<string, string> = { ł: 'l', Ł: 'L', đ: 'd', Đ: 'D', ı: 'i', ħ: 'h', ŋ: 'n' };
export function winAnsi(s: string): string {
  let out = '';
  for (const ch of s.replace(/[\u202f\u2009]/g, ' ')) {
    const code = ch.codePointAt(0)!;
    if ((code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff)) out += ch;
    else if (WIN_ANSI_EXTRA.includes(ch)) out += ch;
    else if (ch === '\n') out += ch;
    else {
      const base = ch.normalize('NFKD').replace(/[̀-ͯ]/g, '');
      out += /^[\x20-\x7e]+$/.test(base) ? base : (FALLBACK[ch] ?? '?');
    }
  }
  return out;
}
