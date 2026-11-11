import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(join(import.meta.dirname, 'theme.css'), 'utf8');

function tokens(block: string): Record<string, string> {
  return Object.fromEntries(
    [...block.matchAll(/--ps-([a-z-]+):\s*(#[0-9a-f]{6})\s*;/gi)].map((m) => [m[1]!, m[2]!]),
  );
}
const lightBlock = css.slice(css.indexOf(':root {'), css.indexOf('@media (prefers-color-scheme'));
const darkBlock = css.slice(css.indexOf('@media (prefers-color-scheme'), css.indexOf('@theme'));
const schemes = { light: tokens(lightBlock), dark: tokens(darkBlock) };

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

// [foreground, background, minimum ratio]. 4.5 = AA body text, 3 = UI component boundaries (1.4.11).
const PAIRS: [string, string, number][] = [
  ['fg', 'bg', 4.5],
  ['fg', 'surface', 4.5],
  ['muted', 'bg', 4.5],
  ['muted', 'surface', 4.5],
  ['primary', 'bg', 4.5],
  ['primary-fg', 'primary', 4.5],
  ['primary-fg', 'primary-hover', 4.5],
  ['secondary-fg', 'secondary', 4.5],
  ['danger-fg', 'danger', 4.5],
  ['info-fg', 'info-bg', 4.5],
  ['success-fg', 'success-bg', 4.5],
  ['warning-fg', 'warning-bg', 4.5],
  ['danger-text', 'danger-bg', 4.5],
  ['border-strong', 'bg', 3],
  ['focus', 'bg', 3],
];

describe.each(Object.entries(schemes))('%s theme contrast (WCAG 2.2 AA)', (_name, t) => {
  it('defines every token used by the checks', () => {
    for (const [fg, bg] of PAIRS) {
      expect(t[fg], fg).toBeDefined();
      expect(t[bg], bg).toBeDefined();
    }
  });
  it.each(PAIRS)('%s on %s >= %s:1', (fg, bg, min) => {
    expect(contrast(t[fg]!, t[bg]!)).toBeGreaterThanOrEqual(min);
  });
});
