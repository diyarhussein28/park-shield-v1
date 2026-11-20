import { useColorScheme, type TextStyle } from 'react-native';

/**
 * Design tokens of the app: the website's colour roles 1:1 (packages/ui/src/theme.css, light and dark;
 * tokens.test.ts checks both the values and their WCAG AA contrast), plus spacing, radius, type and
 * touch sizes. `urgent` is the website's `danger`; `brandYellow` is the logo's QR square, never text.
 */
export interface Theme {
  bg: string;
  fg: string;
  muted: string;
  surface: string;
  border: string;
  borderStrong: string;
  primary: string;
  primaryHover: string;
  primaryFg: string;
  secondary: string;
  secondaryFg: string;
  danger: string;
  dangerFg: string;
  focus: string;
  infoBg: string;
  infoFg: string;
  successBg: string;
  successFg: string;
  warningBg: string;
  warningFg: string;
  dangerBg: string;
  dangerText: string;
  urgent: string;
  brandYellow: string;
}

export const light: Theme = {
  bg: '#ffffff',
  fg: '#0f172a',
  muted: '#475569',
  surface: '#f8fafc',
  border: '#e2e8f0',
  borderStrong: '#64748b',
  primary: '#1d4ed8',
  primaryHover: '#1e40af',
  primaryFg: '#ffffff',
  secondary: '#e2e8f0',
  secondaryFg: '#0f172a',
  danger: '#b91c1c',
  dangerFg: '#ffffff',
  focus: '#1d4ed8',
  infoBg: '#eff6ff',
  infoFg: '#1e3a8a',
  successBg: '#f0fdf4',
  successFg: '#14532d',
  warningBg: '#fffbeb',
  warningFg: '#78350f',
  dangerBg: '#fef2f2',
  dangerText: '#7f1d1d',
  urgent: '#b91c1c',
  brandYellow: '#facc15',
};

export const dark: Theme = {
  bg: '#0b1220',
  fg: '#f1f5f9',
  muted: '#94a3b8',
  surface: '#111a2e',
  border: '#1e293b',
  borderStrong: '#64748b',
  primary: '#60a5fa',
  primaryHover: '#93c5fd',
  primaryFg: '#0b1220',
  secondary: '#1e293b',
  secondaryFg: '#f1f5f9',
  danger: '#f87171',
  dangerFg: '#0b1220',
  focus: '#93c5fd',
  infoBg: '#172554',
  infoFg: '#dbeafe',
  successBg: '#052e16',
  successFg: '#dcfce7',
  warningBg: '#451a03',
  warningFg: '#fef3c7',
  dangerBg: '#450a0a',
  dangerText: '#fee2e2',
  urgent: '#f87171',
  brandYellow: '#facc15',
};

export const useTheme = (): Theme => (useColorScheme() === 'dark' ? dark : light);

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, xxxl: 32 } as const;
export const radius = { sm: 8, md: 12, lg: 16, pill: 999 } as const;

const t = (fontSize: number, lineHeight: number, fontWeight: TextStyle['fontWeight']) => ({
  fontSize,
  lineHeight,
  fontWeight,
});
export const type = {
  display: t(30, 36, '800'),
  title: t(24, 30, '800'),
  heading: t(19, 25, '700'),
  body: t(17, 24, '400'),
  label: t(15, 20, '600'),
  caption: t(13, 18, '500'),
} as const;

/** Minimum touch target, button height, and the alert's „Ich komme“ button. */
export const touch = { min: 48, button: 52, primaryAction: 56 } as const;
