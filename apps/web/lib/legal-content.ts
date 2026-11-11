import type { Locale } from '@parkshield/i18n';

// Drafts derived from docs/04-legal-privacy.md. Placeholders in [brackets] are filled in Phase 0;
// the final wording comes from the IT-law firm and the DPO. German is the binding version.
export type LegalSlug =
  'impressum' | 'datenschutz' | 'agb' | 'widerruf' | 'barrierefreiheit' | 'sicherheit';
const SECURITY = 'security@parkshield.de';

export interface LegalDoc {
  title: string;
  sections: { heading: string; paragraphs: string[] }[];
}

const CONTACT = 'hallo@parkshield.de';

const de: Record<LegalSlug, LegalDoc> = {
  impressum: {
    title: 'Impressum',
    sections: [
      {
        heading: 'Angaben gemäß § 5 DDG',
        paragraphs: [
          '[Firmenname] (in Gründung), [Straße Hausnummer], [PLZ Ort], Deutschland',
          'Vertreten durch die Geschäftsführung: [Vorname Nachname]',
          `E-Mail: ${CONTACT} · Telefon: [Telefonnummer]`,
          'Registereintrag: [Amtsgericht], [HRB-Nummer]',
          'Umsatzsteuer-Identifikationsnummer gemäß § 27a UStG: [USt-IdNr.]',
        ],
      },
      {
        heading: 'Verantwortlich für den Inhalt nach § 18 Abs. 2 MStV',
        paragraphs: ['[Vorname Nachname], Anschrift wie oben'],
      },
      {
        heading: 'Verbraucherstreitbeilegung',
        paragraphs: [
          'Wir sind nicht verpflichtet und nicht bereit, an Streitbeilegungsverfahren vor einer Verbraucherschlichtungsstelle teilzunehmen (§ 36 VSBG).',
        ],
      },
    ],
  },
  datenschutz: {
    title: 'Datenschutzerklärung',
    sections: [
      {
        heading: '1. Verantwortlicher und Datenschutzbeauftragter',
        paragraphs: [
          'Verantwortlich ist [Firmenname], [Anschrift], E-Mail: ' + CONTACT + '.',
          'Unseren externen Datenschutzbeauftragten erreichen Sie unter [datenschutz@…].',
        ],
      },
      {
        heading: '2. Wenn Sie einen Aufkleber scannen',
        paragraphs: [
          'Sie brauchen kein Konto und keine App. Wir setzen auf der Scan-Seite keine Cookies und lesen nichts von Ihrem Gerät aus (§ 25 TDDDG). Ihr Sitzungsschlüssel für den Live-Status liegt nur im Sitzungsspeicher Ihres Browsers.',
          'Ihre IP-Adresse kürzen wir sofort (IPv4 auf /24, IPv6 auf /48) und speichern sie nie vollständig, auch nicht in Server-Logs.',
          'Zum Schutz vor Missbrauch bilden wir aus gekürzter IP-Adresse und Browserkennung eine pseudonyme Kennung, die sich täglich ändert und nach 24 Stunden gelöscht wird. Meldet die Fahrzeughalterin oder der Fahrzeughalter Ihre Nachricht als Missbrauch, nutzen wir eine zweite, nur für dieses Fahrzeug gültige Kennung, um Sie 30 Tage für dieses Fahrzeug zu sperren. Rechtsgrundlage ist Art. 6 Abs. 1 lit. f DSGVO (Schutz vor Missbrauch).',
          'Aus der IP-Adresse leiten wir nur das Land ab, um Ihnen die richtigen Notrufnummern zu zeigen; es wird nach 24 Stunden gelöscht. Die Zuordnung erfolgt auf unseren eigenen Servern mit der Datenbank „IP to Country Lite“ von DB-IP (db-ip.com, Lizenz CC BY 4.0); die IP-Adresse wird dafür an niemanden übermittelt.',
          'Melden Sie einen verdächtigen Aufkleber, speichern wir den betroffenen Code und Ihren freiwilligen Hinweis 90 Tage, um Fälschungen zu prüfen (Art. 6 Abs. 1 lit. f DSGVO).',
          'Die Fahrzeughalterin oder der Fahrzeughalter sieht nur Zeitpunkt, Art der Warnung und gegebenenfalls Ihren Text. Freitexte löschen wir nach 7 Tagen.',
        ],
      },
      {
        heading: '3. Kundenkonto und Abo',
        paragraphs: [
          'Für Ihr Konto verarbeiten wir E-Mail-Adresse, Kanäle, Fahrzeuge (Kennzeichen verschlüsselt) und Warnungen zur Erfüllung des Vertrags (Art. 6 Abs. 1 lit. b DSGVO). Für die Anmeldung setzen wir zwei technisch notwendige Cookies (Sitzung und Schutz vor Cross-Site-Request-Forgery).',
          'Schalten Sie Push-Benachrichtigungen ein, speichern wir die vom Browser erzeugte Zustelladresse und den Gerätetyp. Die Nachrichten laufen Ende-zu-Ende-verschlüsselt über den Push-Dienst Ihres Browsers (Google, Apple, Mozilla oder Microsoft), der den Inhalt nicht lesen kann. Ein Gerät, das nicht mehr erreichbar ist, entfernen wir automatisch.',
          'WhatsApp und SMS nutzen wir nur mit Ihrer Einwilligung (Art. 6 Abs. 1 lit. a DSGVO). Notfallkontakte und Mitfahrende werden erst nach deren eigener Bestätigung genutzt; ohne Antwort löschen wir die Einladung nach 14 Tagen.',
          'Rechnungen bewahren wir aufgrund gesetzlicher Pflichten auf (Art. 6 Abs. 1 lit. c DSGVO, § 147 AO, § 14b UStG).',
          'E-Mail-Adressen, die einen Anmeldelink angefordert, aber nie bestätigt haben, löschen wir nach 24 Stunden.',
        ],
      },
      {
        heading: '4. Empfänger und Auftragsverarbeiter',
        paragraphs: [
          'Hetzner Online (Hosting, Deutschland); Brevo (E-Mail, Frankreich); 360dialog (WhatsApp, Berlin; dabei überträgt Meta Daten in die USA auf Grundlage des EU-US Data Privacy Framework, nur nach Ihrer Einwilligung); Stripe (Zahlungen, Irland); Friendly Captcha (Sicherheitsprüfung ohne Cookies, Deutschland); unsere Druckerei (Versand des Aufklebers, Deutschland); Sentry (Fehlerprotokolle ohne personenbezogene Daten, EU). Mit allen bestehen Verträge zur Auftragsverarbeitung.',
        ],
      },
      {
        heading: '5. Speicherdauer',
        paragraphs: [
          'Warnungen und Zustellprotokolle: 90 Tage. Lieferadresse: 90 Tage nach Zustellung. Server-Logs: 14 Tage ohne vollständige IP-Adresse. Rechnungen: 8 Jahre. Gelöschte Daten verschwinden spätestens nach 35 Tagen auch aus unseren verschlüsselten Sicherungen.',
        ],
      },
      {
        heading: '6. Ihre Rechte',
        paragraphs: [
          'Sie haben das Recht auf Auskunft, Berichtigung, Löschung, Einschränkung, Datenübertragbarkeit und Widerspruch (Art. 15 bis 21 DSGVO) sowie auf Widerruf erteilter Einwilligungen. Ihre Daten können Sie im Konto selbst herunterladen und löschen. Sie können sich bei einer Datenschutz-Aufsichtsbehörde beschweren (Art. 77 DSGVO).',
        ],
      },
    ],
  },
  agb: {
    title: 'Allgemeine Geschäftsbedingungen',
    sections: [
      {
        heading: '§ 1 Leistung',
        paragraphs: [
          'ParkShield ermöglicht es Dritten, Sie über einen QR-Aufkleber an Ihrem Fahrzeug zu benachrichtigen, ohne dass Ihre Kontaktdaten sichtbar werden. Die Zustellung über Push, E-Mail, WhatsApp oder SMS hängt auch von Drittanbietern ab; eine bestimmte Zustellzeit können wir nicht garantieren.',
        ],
      },
      {
        heading: '§ 2 Vertragsschluss',
        paragraphs: [
          'Der Vertrag kommt zustande, wenn Sie auf „Zahlungspflichtig bestellen“ klicken und die Zahlung erfolgreich ist. Ihr Schutz beginnt erst nach erfolgreicher Zahlung.',
        ],
      },
      {
        heading: '§ 3 Preise und Zahlung',
        paragraphs: [
          'ParkShield Plus kostet 10 € pro Jahr inklusive 19 % Umsatzsteuer und wird jährlich im Voraus berechnet. Bei der ersten Buchung ist ein Aufkleber inklusive Versand enthalten; weitere Aufkleber sind kostenpflichtig, das PDF zum Selbstausdrucken ist jederzeit kostenlos.',
        ],
      },
      {
        heading: '§ 4 Laufzeit und Kündigung',
        paragraphs: [
          'Die erste Laufzeit beträgt ein Jahr. Danach verlängert sich der Vertrag auf unbestimmte Zeit und ist jederzeit mit einer Frist von einem Monat kündbar; zu viel gezahlte Beträge erstatten wir anteilig.',
          'Sie können jederzeit über „Verträge hier kündigen“ kündigen, auch ohne Anmeldung. Wir bestätigen den Eingang sofort per E-Mail. Das Recht zur außerordentlichen Kündigung bleibt unberührt.',
        ],
      },
      {
        heading: '§ 5 Ihre Pflichten',
        paragraphs: [
          'Bitte bringen Sie den Aufkleber nur an Fahrzeugen an, die Sie nutzen dürfen, und halten Sie Ihre Kanäle aktuell. Ein Missbrauch des Dienstes, insbesondere zum Belästigen Dritter, ist untersagt.',
        ],
      },
      {
        heading: '§ 6 Haftung',
        paragraphs: [
          'Wir haften unbeschränkt bei Vorsatz, grober Fahrlässigkeit und bei Verletzung von Leben, Körper oder Gesundheit. Bei leichter Fahrlässigkeit haften wir nur für die Verletzung wesentlicher Vertragspflichten und begrenzt auf den vorhersehbaren, vertragstypischen Schaden. ParkShield ersetzt keine Notrufe: In Gefahr wählen Sie bitte 110 oder 112.',
        ],
      },
      {
        heading: '§ 7 Widerruf und Schluss',
        paragraphs: [
          'Ihr Widerrufsrecht ergibt sich aus der Widerrufsbelehrung. Es gilt deutsches Recht; zwingende Verbraucherschutzvorschriften Ihres Aufenthaltsstaats bleiben unberührt.',
        ],
      },
    ],
  },
  widerruf: {
    title: 'Widerrufsbelehrung',
    sections: [
      {
        heading: 'Widerrufsrecht',
        paragraphs: [
          'Sie haben das Recht, binnen vierzehn Tagen ohne Angabe von Gründen diesen Vertrag zu widerrufen. Die Widerrufsfrist beträgt vierzehn Tage ab dem Tag des Vertragsschlusses.',
          `Um Ihr Widerrufsrecht auszuüben, müssen Sie uns ([Firmenname], [Anschrift], E-Mail: ${CONTACT}) mittels einer eindeutigen Erklärung (zum Beispiel per E-Mail) über Ihren Entschluss informieren. Sie können dafür das unten stehende Muster-Widerrufsformular verwenden, das jedoch nicht vorgeschrieben ist.`,
          'Zur Wahrung der Widerrufsfrist reicht es aus, dass Sie die Mitteilung vor Ablauf der Widerrufsfrist absenden.',
        ],
      },
      {
        heading: 'Folgen des Widerrufs',
        paragraphs: [
          'Wenn Sie diesen Vertrag widerrufen, zahlen wir Ihnen alle Zahlungen, die wir von Ihnen erhalten haben, unverzüglich und spätestens binnen vierzehn Tagen zurück, über dasselbe Zahlungsmittel, das Sie verwendet haben.',
          'Haben Sie verlangt, dass die Leistung während der Widerrufsfrist beginnt, zahlen Sie uns einen angemessenen Betrag, der dem Anteil der bis zum Widerruf erbrachten Leistung im Vergleich zum Gesamtumfang entspricht (Wertersatz).',
          'Ein nach Ihren Vorgaben individuell gestalteter und bedruckter Aufkleber ist vom Widerruf ausgeschlossen (§ 312g Abs. 2 Nr. 1 BGB); seine Kosten werden nicht erstattet.',
        ],
      },
      {
        heading: 'Muster-Widerrufsformular',
        paragraphs: [
          `An [Firmenname], [Anschrift], E-Mail: ${CONTACT}:`,
          'Hiermit widerrufe(n) ich/wir den von mir/uns abgeschlossenen Vertrag über die Erbringung der folgenden Dienstleistung: ParkShield-Abo, Vertragsnummer ______',
          'Bestellt am ______ · Name ______ · Anschrift ______ · Datum ______',
        ],
      },
    ],
  },
  sicherheit: {
    title: 'Sicherheitslücken melden',
    sections: [
      {
        heading: 'So melden Sie eine Lücke',
        paragraphs: [
          `Haben Sie eine Sicherheitslücke in ParkShield gefunden? Schreiben Sie uns an ${SECURITY}. Beschreiben Sie bitte, wie wir das Problem nachvollziehen können. Wir bestätigen den Eingang innerhalb von 3 Werktagen und halten Sie über die Behebung auf dem Laufenden.`,
          'Wir verzichten auf rechtliche Schritte gegen Personen, die eine Lücke in gutem Glauben und nach diesen Regeln melden.',
        ],
      },
      {
        heading: 'Regeln',
        paragraphs: [
          'Greifen Sie nur auf Ihre eigenen Konten und Daten zu. Laden Sie keine fremden Daten herunter, verändern oder löschen Sie nichts, und brechen Sie den Test ab, sobald Sie fremde Daten sehen.',
          'Keine Tests, die den Dienst stören (Last, Spam, Massen-Scans von Aufklebern), kein Social Engineering, keine Angriffe auf unsere Dienstleister oder Mitarbeitenden.',
          'Veröffentlichen Sie die Lücke erst, wenn wir sie behoben haben oder 90 Tage vergangen sind.',
        ],
      },
    ],
  },
  barrierefreiheit: {
    title: 'Erklärung zur Barrierefreiheit',
    sections: [
      {
        heading: 'Stand der Vereinbarkeit',
        paragraphs: [
          'Wir möchten ParkShield für alle nutzbar machen und richten uns nach WCAG 2.2 Stufe AA sowie dem Barrierefreiheitsstärkungsgesetz (BFSG). Nach unserer eigenen Prüfung erfüllen die Website, das Kundenkonto und die Scan-Seite diese Anforderungen. Bekannte Barrieren: derzeit keine.',
        ],
      },
      {
        heading: 'Wie wir prüfen',
        paragraphs: [
          'Stand: 10. November 2026. Jede Seite wird bei jeder Änderung automatisch geprüft, auf Deutsch und Englisch: WCAG-2.2-AA-Regeln, Darstellung auf 320 Pixel breiten Bildschirmen und bei 200 % Vergrößerung ohne waagerechtes Scrollen, vergrößerte Zeilen- und Zeichenabstände, reduzierte Bewegung und die wichtigsten Abläufe (Anmelden, Warnung senden) nur mit der Tastatur, mit sichtbarem Fokus.',
          'Vor dem Start prüft eine unabhängige Stelle zusätzlich mit Screenreadern und mit Menschen mit Behinderungen; diese Erklärung wird danach aktualisiert.',
        ],
      },
      {
        heading: 'Barriere melden',
        paragraphs: [
          `Ist Ihnen eine Barriere aufgefallen? Schreiben Sie uns an ${CONTACT}. Wir antworten innerhalb von 14 Tagen.`,
        ],
      },
      {
        heading: 'Marktüberwachung',
        paragraphs: [
          'Zuständig ist die Marktüberwachungsstelle der Länder für die Barrierefreiheit von Produkten und Dienstleistungen (MLBF) in Magdeburg.',
        ],
      },
    ],
  },
};

const en: Record<LegalSlug, LegalDoc> = {
  impressum: {
    title: 'Legal notice',
    sections: [
      {
        heading: 'Information pursuant to § 5 DDG',
        paragraphs: [
          '[Company name] (in formation), [Street], [Postcode City], Germany',
          'Represented by the managing director: [First name Last name]',
          `E-mail: ${CONTACT} · Phone: [Phone number]`,
          'Commercial register: [Local court], [HRB number] · VAT ID: [VAT ID]',
        ],
      },
      {
        heading: 'Consumer dispute resolution',
        paragraphs: [
          'We are neither obliged nor willing to take part in consumer arbitration proceedings (§ 36 VSBG).',
        ],
      },
    ],
  },
  datenschutz: {
    title: 'Privacy policy',
    sections: [
      {
        heading: 'When you scan a decal',
        paragraphs: [
          'No account, no app, no cookies, nothing read from your device. Your IP address is truncated immediately and never stored in full. A pseudonymous reference that changes daily (deleted after 24 h) protects against abuse; if the owner reports a message, a second reference valid for that one vehicle blocks you there for 30 days. Your country is used only to show the right emergency numbers and is deleted after 24 h; it is looked up on our own servers with DB-IP’s “IP to Country Lite” database (db-ip.com, licensed CC BY 4.0). Free text is deleted after 7 days. Reports of suspicious decals are kept for 90 days.',
        ],
      },
      {
        heading: 'Your account',
        paragraphs: [
          'We process your e-mail address, channels, vehicles (licence plate encrypted) and alerts to provide the service. Push notifications travel end-to-end encrypted through your browser’s push service; unreachable devices are removed automatically. WhatsApp and SMS only with your consent. Two strictly necessary cookies keep you signed in securely. Unverified sign-ups are deleted after 24 h; deleted data leaves our encrypted backups within 35 days.',
        ],
      },
      {
        heading: 'Your rights',
        paragraphs: [
          'You can access, correct, export and delete your data, object, restrict processing and withdraw consent (Art. 15–21 GDPR), and complain to a supervisory authority (Art. 77 GDPR).',
        ],
      },
    ],
  },
  agb: {
    title: 'Terms',
    sections: [
      {
        heading: 'Summary',
        paragraphs: [
          'ParkShield Plus costs €10 per year including 19% VAT, billed yearly in advance. The first term is one year; afterwards the contract continues indefinitely and can be cancelled at any time with one month’s notice, with a pro-rata refund. Cancel any time via “Cancel contract here”, even without signing in. ParkShield does not replace emergency calls: in danger, call 110 or 112.',
        ],
      },
    ],
  },
  widerruf: {
    title: 'Withdrawal policy',
    sections: [
      {
        heading: 'Right of withdrawal',
        paragraphs: [
          `You may withdraw from this contract within fourteen days without giving reasons by sending a clear statement to ${CONTACT}. If you asked for the service to start immediately, you pay a proportionate amount for the service provided until withdrawal. A custom-printed decal cannot be returned.`,
        ],
      },
    ],
  },
  sicherheit: {
    title: 'Reporting security issues',
    sections: [
      {
        heading: 'How to report',
        paragraphs: [
          `Found a security issue in ParkShield? Write to ${SECURITY} and describe how we can reproduce it. We confirm receipt within 3 working days and keep you informed about the fix.`,
          'We will not take legal action against anyone who reports an issue in good faith and follows these rules.',
        ],
      },
      {
        heading: 'Rules',
        paragraphs: [
          'Only access your own accounts and data. Do not download, change or delete anyone else’s data, and stop as soon as you see data that is not yours.',
          'No tests that disrupt the service (load, spam, mass scanning of decals), no social engineering, no attacks on our providers or staff.',
          'Please do not publish the issue before we have fixed it or 90 days have passed.',
        ],
      },
    ],
  },
  barrierefreiheit: {
    title: 'Accessibility statement',
    sections: [
      {
        heading: 'Status',
        paragraphs: [
          'We want ParkShield to work for everyone and follow WCAG 2.2 level AA and the German Accessibility Strengthening Act (BFSG). By our own assessment the website, the customer account and the scanner page meet these requirements. Known barriers: none at the moment.',
        ],
      },
      {
        heading: 'How we test',
        paragraphs: [
          'As of 10 November 2026. Every page is checked automatically on every change, in German and English: WCAG 2.2 AA rules, display on 320-pixel-wide screens and at 200 % zoom without horizontal scrolling, increased line and letter spacing, reduced motion, and the main flows (signing in, sending an alert) with the keyboard only and a visible focus.',
          'Before launch an independent body also tests with screen readers and with people with disabilities; this statement will be updated afterwards.',
        ],
      },
      {
        heading: 'Report a barrier',
        paragraphs: [
          `Have you found a barrier? Write to ${CONTACT}; we reply within 14 days. Market surveillance: MLBF, Magdeburg.`,
        ],
      },
    ],
  },
};

export const legalContent: Record<Locale, Record<LegalSlug, LegalDoc>> = { de, en };
