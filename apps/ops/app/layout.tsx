import type { Metadata } from 'next';
import { connection } from 'next/server';
import type { ReactNode } from 'react';
import { Providers } from '@/components/providers';
import { requestLocale } from '@/lib/locale';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'ParkShield Ops', template: '%s · ParkShield Ops' },
  robots: { index: false, follow: false },
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  // Every page must render per request: the CSP in proxy.ts carries a fresh nonce, and Next only
  // stamps it on the scripts of dynamically rendered pages. A prerendered page has scripts without
  // the nonce, the browser blocks them all and the page never becomes interactive.
  await connection();
  const locale = await requestLocale();
  return (
    <html lang={locale}>
      <body className="min-h-dvh bg-bg text-fg antialiased">
        <Providers locale={locale}>{children}</Providers>
      </body>
    </html>
  );
}
