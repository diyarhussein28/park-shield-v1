import { ContactAlert } from './contact-alert';

// From an escalation SMS or e-mail: never indexed, never cached, no referrer (global headers).
export const metadata = {
  title: 'Hinweis für Vertrauenspersonen',
  robots: { index: false, follow: false },
};
export const dynamic = 'force-dynamic';

/** A trusted contact's link (`/k/<token>`): "Ich komme" and "Keine Benachrichtigungen mehr erhalten". */
export default async function ContactAlertPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <ContactAlert token={token} />;
}
