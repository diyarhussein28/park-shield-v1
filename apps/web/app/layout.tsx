import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { Providers } from '@/components/providers';
import { requestLocale } from '@/lib/locale';
// Self-hosted font files (served from /_next/static), so no third-party request (GDPR).
import '@fontsource-variable/plus-jakarta-sans';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'ParkShield', template: '%s · ParkShield' },
  description: 'Ihre Handynummer gehört nicht hinter die Windschutzscheibe.',
  // PWA: on iOS, Web Push works only for sites added to the home screen (US-20).
  manifest: '/manifest.webmanifest',
  icons: {
    icon: [{ url: '/icons/favicon-32.png', sizes: '32x32', type: 'image/png' }],
    apple: [{ url: '/icons/apple-touch-icon.png', sizes: '180x180' }],
  },
  appleWebApp: { capable: true, title: 'ParkShield', statusBarStyle: 'default' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#0b1220' },
  ],
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = await requestLocale();
  return (
    <html lang={locale}>
      <body className="min-h-dvh bg-bg text-fg antialiased">
        <Providers locale={locale}>{children}</Providers>
      </body>
    </html>
  );
}
