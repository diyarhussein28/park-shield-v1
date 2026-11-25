/**
 * The official ParkShield mark: the blue shield with the white QR finder squares (one yellow). This file
 * is its only definition on the website: the React logo (`components/brand/logo.tsx`), the scanner page
 * (`lib/scanner/render.ts`, plain HTML) and the rendered images (favicon, app icons and the e-mail logo,
 * `scripts/email-assets.ts`) are all built from it, so they cannot drift apart. Never redraw it, and
 * never use another icon (a star, a check mark) as the logo.
 */

/** The shield outline on a 32 × 32 grid. */
export const MARK_SHIELD = 'M16 2 4 6.5v8.6C4 22.4 9.1 28.2 16 30c6.9-1.8 12-7.6 12-14.9V6.5L16 2Z';

/** The shield's gradient, top left to bottom right. */
export const MARK_GRADIENT = ['#3b82f6', '#1d4ed8'] as const;

/** The QR finder squares inside the shield: x, y, size, corner radius, colour. */
export const MARK_SQUARES: readonly (readonly [number, number, number, number, string])[] = [
  [10, 10, 5, 1, '#fff'],
  [17, 10, 5, 1, '#facc15'],
  [10, 17, 5, 1, '#fff'],
  [17.5, 17.5, 2, 0, '#fff'],
  [20.5, 20.5, 2, 0, '#fff'],
];

/**
 * The mark's SVG body (gradient definition, shield and squares) for string output. `gradientId` must be
 * unique in the document.
 */
export function markSvgBody(gradientId: string): string {
  const [from, to] = MARK_GRADIENT;
  const squares = MARK_SQUARES.map(
    ([x, y, s, r, fill]) =>
      `<rect x="${x}" y="${y}" width="${s}" height="${s}"${r ? ` rx="${r}"` : ''} fill="${fill}"/>`,
  ).join('');
  return (
    `<defs><linearGradient id="${gradientId}" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs>` +
    `<path d="${MARK_SHIELD}" fill="url(#${gradientId})"/>${squares}`
  );
}
