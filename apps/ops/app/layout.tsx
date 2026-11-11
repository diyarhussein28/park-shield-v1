import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Providers } from '@/components/providers';
import { requestLocale } from '@/lib/locale';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'ParkShield Ops', template: '%s · ParkShield Ops' },
  robots: { index: false, follow: false },
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
