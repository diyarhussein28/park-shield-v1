import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { dark, light, type Theme } from './tokens';

/* The app's colours are the website's: parsed from packages/ui/src/theme.css, light and dark. */
const css = readFileSync(join(__dirname, '../../../../packages/ui/src/theme.css'), 'utf8');
const parse = (block: string): Record<string, string> =>
  Object.fromEntries(
    [...block.matchAll(/--ps-([a-z-]+):\s*(#[0-9a-f]{6})\s*;/gi)].map((m) => [
      m[1]!.replace(/-([a-z])/g, (_, ch: string) => ch.toUpperCase()),
      m[2]!.toLowerCase(),
    ]),
  );
const web = {
  light: parse(css.slice(css.indexOf(':root {'), css.indexOf('@media (prefers-color-scheme'))),
  dark: parse(css.slice(css.indexOf('@media (prefers-color-scheme'), css.indexOf('@theme'))),
};

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
};

it('mirrors the website colours (light and dark)', () => {
  for (const [scheme, theme] of [
    ['light', light],
    ['dark', dark],
  ] as const) {
    expect(Object.keys(web[scheme]).length).toBeGreaterThan(15);
    for (const [key, value] of Object.entries(web[scheme])) {
      expect([scheme, key, theme[key as keyof Theme]?.toLowerCase()]).toEqual([scheme, key, value]);
    }
    expect(theme.urgent).toBe(theme.danger);
    expect(theme.brandYellow).toBe('#facc15');
  }
});

const PAIRS: [keyof Theme, keyof Theme][] = [
  ['fg', 'bg'],
  ['fg', 'surface'],
  ['muted', 'bg'],
  ['muted', 'surface'],
  ['primary', 'bg'],
  ['primary', 'surface'],
  ['primaryFg', 'primary'],
  ['dangerFg', 'danger'],
  ['infoFg', 'infoBg'],
  ['successFg', 'successBg'],
  ['warningFg', 'warningBg'],
  ['dangerText', 'dangerBg'],
  ['accentFg', 'accent'],
  ['accentSubtleFg', 'accentSubtle'],
];

it('every text/background pair meets WCAG AA in both themes', () => {
  for (const theme of [light, dark]) {
    for (const [fg, bg] of PAIRS) {
      expect([fg, bg, contrast(theme[fg], theme[bg]) >= 4.5]).toEqual([fg, bg, true]);
    }
  }
});
