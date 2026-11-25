// Drafts derived from docs/04-legal-privacy.md, filled with the data of the registered business
// (Gewerbe-Ummeldung Leverkusen, USt-IdNr. from the BZSt). The final wording still comes from the
// IT-law firm. German is the binding version. TODO [LEGAL REVIEW]: every text in this file
// (LEGAL_REVIEW.md). Shared by the website and the API (contract confirmation e-mail, § 312f BGB).
type Locale = 'de' | 'en';

/** Bump when a text a customer agrees to changes; stored with the contract confirmation. */
// 2026-11-28: personalised sticker excluded from withdrawal, Wertersatz after the sticker value, store
// purchases (Apple/Google), RevenueCat in the privacy policy (Part A/B of the billing task).
export const LEGAL_DOC_VERSION = '2026-11-28';

/** What the texts depend on at runtime (app_settings), so a switch needs no code change. */
export interface LegalContext {
  /** § 309 Nr. 9 BGB: see renewal.mode_b2c. */
  renewalMode: 'annual' | 'monthly_after_first_term';
}

export const DEFAULT_LEGAL_CONTEXT: LegalContext = { renewalMode: 'annual' };

export type LegalSlug =
  'impressum' | 'datenschutz' | 'agb' | 'widerruf' | 'barrierefreiheit' | 'sicherheit';
const SECURITY = 'contact@park-shield.de';

export interface LegalDoc {
  title: string;
  sections: { heading: string; paragraphs: string[] }[];
}

/** The registered business, as in the Impressum. Default company data on letters (ops can edit). */
export const COMPANY = {
  name: 'Diyar Hussein Dienstleistungen',
  legalForm: 'Einzelunternehmen',
  owner: 'Diyar Hussein',
  street: 'Monheimer Str. 24',
  postalCode: '51371',
  city: 'Leverkusen',
  country: 'DE',
  // Company mailbox on the website domain (Strato); Twilio Trust Hub needs the same domain for both.
  email: 'contact@park-shield.de',
  phone: '+49 176 20591765',
  website: 'park-shield.de',
  vatId: 'DE454570643',
} as const;

const CONTACT = COMPANY.email;
const OPERATOR = `${COMPANY.name}, Inhaber ${COMPANY.owner}`;
const ADDRESS = `${COMPANY.street}, ${COMPANY.postalCode} ${COMPANY.city}`;
const PHONE = COMPANY.phone;
const VAT_ID = COMPANY.vatId;

const de = (ctx: LegalContext): Record<LegalSlug, LegalDoc> => ({
  impressum: {
    title: 'Impressum',
    sections: [
      {
        heading: 'Angaben gemäß § 5 DDG',
        paragraphs: [
          'ParkShield ist ein Angebot von:',
          `Diyar Hussein Dienstleistungen, Inhaber: Diyar Hussein, ${ADDRESS}, Deutschland`,
          `E-Mail: ${CONTACT} · Telefon: ${PHONE}`,
          'Einzelunternehmen, nicht im Handelsregister eingetragen.',
          `Umsatzsteuer-Identifikationsnummer gemäß § 27a UStG: ${VAT_ID}`,
        ],
      },
      {
        heading: 'Verantwortlich für den Inhalt nach § 18 Abs. 2 MStV',
        paragraphs: ['Diyar Hussein, Anschrift wie oben'],
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
          `Verantwortlich ist ${OPERATOR}, ${ADDRESS}, E-Mail: ${CONTACT}.`,
          `Einen Datenschutzbeauftragten haben wir nicht benannt, weil dafür keine Pflicht besteht (§ 38 BDSG). Fragen zum Datenschutz richten Sie bitte an ${CONTACT}.`,
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
          'Für Ihr Konto verarbeiten wir E-Mail-Adresse, Kanäle, Fahrzeuge (Kennzeichen verschlüsselt) und Warnungen zur Erfüllung des Vertrags (Art. 6 Abs. 1 lit. b DSGVO). Für die Anmeldung setzen wir zwei technisch notwendige Cookies (Sitzung und Schutz vor Cross-Site-Request-Forgery). Wenn Sie auf der Website die Sprache wechseln, merken wir uns Ihre Wahl in einem Cookie (ps_lang, ein Jahr, ohne personenbezogene Daten, § 25 Abs. 2 TDDDG).',
          'Schalten Sie Push-Benachrichtigungen ein, speichern wir die vom Browser erzeugte Zustelladresse und den Gerätetyp. Die Nachrichten laufen Ende-zu-Ende-verschlüsselt über den Push-Dienst Ihres Browsers (Google, Apple, Mozilla oder Microsoft), der den Inhalt nicht lesen kann. Ein Gerät, das nicht mehr erreichbar ist, entfernen wir automatisch.',
          // TODO [LEGAL REVIEW] Mandatory phone number for the escalation SMS (owner decision 2026-11-21).
          'Ihre Handynummer ist bei der Registrierung Pflicht. Wir bestätigen sie mit einem SMS-Code (Twilio Verify) und prüfen, ob es eine Mobilfunknummer ist (Twilio Lookup). Wir nutzen sie ausschließlich, um Ihnen eine SMS zu senden, wenn Sie auf eine Warnung 30 Minuten lang nicht reagiert haben (Art. 6 Abs. 1 lit. b DSGVO, Vertragserfüllung). Wir speichern die Nummer verschlüsselt und zeigen sie im Konto nur gekürzt an.',
          'Rechnungen bewahren wir aufgrund gesetzlicher Pflichten auf (Art. 6 Abs. 1 lit. c DSGVO, § 147 AO, § 14b UStG).',
          // TODO [LEGAL REVIEW] In-app subscriptions through Apple/Google and RevenueCat (Part A, 2026-11-22).
          'Schließen Sie das Abo in unserer iPhone- oder Android-App ab, kaufen Sie es bei Apple (App Store) oder Google (Google Play); Apple bzw. Google ist dann Verkäufer und verarbeitet Ihre Zahlungsdaten in eigener Verantwortung. Damit wir wissen, ob Ihr Abo aktiv ist, nutzen wir den Dienst RevenueCat (RevenueCat, Inc., USA) als Auftragsverarbeiter (Art. 6 Abs. 1 lit. b DSGVO). RevenueCat erhält nur eine zufällige Kundenkennung (UUID) und die Kaufdaten des Stores (Produkt, Kaufzeitpunkt, Laufzeit, Status, Transaktionsnummer), keine E-Mail-Adresse, keinen Namen und keine Werbe-ID. Die Übermittlung in die USA erfolgt auf Grundlage von EU-Standardvertragsklauseln (Art. 46 Abs. 2 lit. c DSGVO) und eines Vertrags zur Auftragsverarbeitung.',
          'E-Mail-Adressen, die einen Anmeldelink angefordert, aber nie bestätigt haben, löschen wir nach 24 Stunden.',
        ],
      },
      {
        heading: '4. Empfänger und Auftragsverarbeiter',
        paragraphs: [
          'Contabo GmbH (Hosting und verschlüsselte Datensicherungen, München, Deutschland); Mailjet (E-Mail ohne Öffnungs- und Klick-Tracking, Sinch Mailjet SAS, Frankreich); Twilio Ireland Limited, Irland (nur nach Ihrer Einwilligung: SMS; dabei überträgt Twilio Daten in die USA auf Grundlage des EU-US Data Privacy Framework und von EU-Standardvertragsklauseln); Stripe (Zahlungen auf der Website und gedruckte Aufkleber, Irland); RevenueCat, Inc., USA (Abo-Status bei Käufen in der App über Apple oder Google; nur Kundenkennung und Kaufdaten; EU-Standardvertragsklauseln); Friendly Captcha (Sicherheitsprüfung ohne Cookies, Deutschland); unsere Druckerei (Versand des Aufklebers, Deutschland); Sentry (Fehlerprotokolle ohne personenbezogene Daten, EU). Mit allen bestehen Verträge zur Auftragsverarbeitung.',
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
          // TODO [LEGAL REVIEW] Single plan, app-only alerts with SMS escalation (owner decision 2026-11-21).
          'ParkShield ermöglicht es Dritten, Sie über einen QR-Aufkleber an Ihrem Fahrzeug zu benachrichtigen, ohne dass Ihre Kontaktdaten sichtbar werden. Warnungen erhalten Sie als Mitteilung in der ParkShield-App; reagieren Sie nicht, erinnern wir Sie in der App und senden Ihnen einmal eine SMS an Ihre bestätigte Handynummer. Die Zustellung hängt auch von Drittanbietern ab; eine bestimmte Zustellzeit können wir nicht garantieren.',
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
          // TODO [LEGAL REVIEW] Price, welcome print and the 3 € print order (owner decision 2026-11-21);
          // the personalised sticker and its value (Part B, 2026-11-22).
          'ParkShield kostet 19,99 € pro Jahr inklusive 19 % Umsatzsteuer für ein Fahrzeug und wird jährlich im Voraus berechnet. Enthalten sind App-Mitteilungen, Erinnerung, SMS-Eskalation, Fotos bei Warnungen, Chat und ein gedruckter Aufkleber inklusive Versand (Willkommensdruck). Im Preis enthalten ist damit ein personalisierter Aufkleber inklusive Versand im Wert von 3 €. Er wird nach Ihren Angaben gefertigt (gewähltes Design und Ihr Fahrzeugname; das Kennzeichen wird nie gedruckt) und erst gedruckt, nachdem Sie die Gestaltung bestätigt haben. Jeder weitere gedruckte und zugesandte Aufkleber kostet einmalig 3 € inklusive Umsatzsteuer und Versand; das PDF zum Selbstausdrucken ist jederzeit kostenlos.',
          'Schließen Sie das Abo in unserer App über den App Store (Apple) oder Google Play ab, ist Apple bzw. Google Verkäufer; Zahlung, Belege, Verlängerung und Kündigung laufen dann über Ihr Apple- bzw. Google-Konto.',
        ],
      },
      {
        heading: '§ 4 Laufzeit und Kündigung',
        paragraphs: [
          renewalRule('de', ctx),
          'Sie können jederzeit über „Verträge hier kündigen“ kündigen, auch ohne Anmeldung. Wir bestätigen den Eingang sofort per E-Mail und nennen das Vertragsende. Bis dahin bleibt Ihr Schutz aktiv. Das Recht zur außerordentlichen Kündigung bleibt unberührt.',
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
          `Um Ihr Widerrufsrecht auszuüben, müssen Sie uns (${OPERATOR}, ${ADDRESS}, E-Mail: ${CONTACT}) mittels einer eindeutigen Erklärung (zum Beispiel per E-Mail) über Ihren Entschluss informieren. Sie können dafür das unten stehende Muster-Widerrufsformular verwenden, das jedoch nicht vorgeschrieben ist.`,
          'Sie können den Widerruf auch online erklären: über die Schaltfläche „Vertrag widerrufen“ unten auf jeder Seite unserer Website (§ 356a BGB). Wir bestätigen den Eingang Ihres Widerrufs unverzüglich per E-Mail.',
          'Zur Wahrung der Widerrufsfrist reicht es aus, dass Sie die Mitteilung vor Ablauf der Widerrufsfrist absenden.',
        ],
      },
      {
        heading: 'Folgen des Widerrufs',
        paragraphs: [
          'Wenn Sie diesen Vertrag widerrufen, zahlen wir Ihnen alle Zahlungen, die wir von Ihnen erhalten haben, unverzüglich und spätestens binnen vierzehn Tagen zurück, über dasselbe Zahlungsmittel, das Sie verwendet haben.',
          'Haben Sie verlangt, dass die Leistung während der Widerrufsfrist beginnt, zahlen Sie uns einen angemessenen Betrag, der dem Anteil der bis zum Widerruf erbrachten Leistung im Vergleich zum Gesamtumfang entspricht (Wertersatz).',
          // TODO [LEGAL REVIEW] Wertersatz after the sticker value (Part B, 2026-11-22; formula in LEGAL_REVIEW.md §12).
          'Den Wert des personalisierten Aufklebers (3 €) erstatten wir nicht, wenn er vor Ihrem Widerruf nach Ihren Angaben gestaltet und zum Druck bestätigt wurde. Der Wertersatz für die bis zum Widerruf genutzten Tage wird anteilig aus dem übrigen Betrag berechnet (Preis abzüglich Aufkleberwert, geteilt durch die Tage des Vertragsjahres, mal genutzte Tage). Widerrufen Sie, bevor Sie den Aufkleber bestätigt haben, ziehen wir nichts für den Aufkleber ab und versenden keinen.',
          'Den Aufkleber müssen Sie nicht zurücksenden. Mit dem Widerruf wird sein Code dauerhaft deaktiviert.',
          // TODO [LEGAL REVIEW] Store purchases: Apple/Google decide on withdrawal and refunds.
          'Haben Sie das Abo in unserer App über den App Store oder Google Play abgeschlossen, ist Apple bzw. Google Ihr Vertragspartner für die Zahlung. Widerruf und Erstattung beantragen Sie dann bei Apple (reportaproblem.apple.com) bzw. Google (Google-Play-Bestellverlauf); diese entscheiden über die Erstattung.',
        ],
      },
      {
        // TODO [LEGAL REVIEW] § 312g Abs. 2 Nr. 1 BGB exclusion for the personalised sticker (Part B).
        heading: 'Ausschluss des Widerrufsrechts für den personalisierten Aufkleber',
        paragraphs: [
          'Das Widerrufsrecht besteht nicht bei Verträgen zur Lieferung von Waren, die nicht vorgefertigt sind und für deren Herstellung eine individuelle Auswahl oder Bestimmung durch den Verbraucher maßgeblich ist (§ 312g Abs. 2 Nr. 1 BGB). Der gedruckte ParkShield-Aufkleber wird nach Ihren Angaben gefertigt (Ihr Fahrzeugname und das von Ihnen gewählte Design). Für ihn besteht daher kein Widerrufsrecht; das gilt auch für jeden zusätzlich bestellten Aufkleber für 3 €. Ihr Widerrufsrecht für das Abo bleibt bestehen.',
        ],
      },
      {
        heading: 'Muster-Widerrufsformular',
        paragraphs: [
          `An ${OPERATOR}, ${ADDRESS}, E-Mail: ${CONTACT}:`,
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
});

const en = (ctx: LegalContext): Record<LegalSlug, LegalDoc> => ({
  impressum: {
    title: 'Legal notice',
    sections: [
      {
        heading: 'Information pursuant to § 5 DDG',
        paragraphs: [
          'ParkShield is offered by:',
          `Diyar Hussein Dienstleistungen, owner: Diyar Hussein, ${ADDRESS}, Germany`,
          `E-mail: ${CONTACT} · Phone: ${PHONE}`,
          'Sole proprietorship, not entered in the commercial register.',
          `VAT ID pursuant to § 27a UStG: ${VAT_ID}`,
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
          'We process your e-mail address, channels, vehicles (licence plate encrypted) and alerts to provide the service. Push notifications travel end-to-end encrypted through your browser’s push service; unreachable devices are removed automatically. Your mobile number is required: we verify it with an SMS code and use it only for one SMS when you have not reacted to an alert for 30 minutes; it is stored encrypted. Two strictly necessary cookies keep you signed in securely; if you switch the language, a third one (ps_lang, one year, no personal data) remembers your choice. Unverified sign-ups are deleted after 24 h; deleted data leaves our encrypted backups within 35 days.',
          // TODO [LEGAL REVIEW] RevenueCat (Part A, 2026-11-22).
          'If you subscribe in our iPhone or Android app, you buy from Apple (App Store) or Google (Google Play), who process your payment data as sellers. To know whether your subscription is active we use RevenueCat (RevenueCat, Inc., USA) as our processor; it receives only a random customer ID (UUID) and the store purchase data, never your e-mail address, name or advertising ID. The transfer to the USA is based on EU Standard Contractual Clauses and a data processing agreement.',
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
          // TODO [LEGAL REVIEW] Single plan (owner decision 2026-11-21).
          'ParkShield costs €19.99 per year including 19% VAT for one vehicle, billed yearly in advance. App notifications, the reminder, SMS escalation, alert photos, chat and one printed and shipped decal (welcome print) are included. Every further printed and shipped decal costs €3 once, VAT and shipping included; the PDF to print yourself is always free. The included personalised decal incl. shipping is worth €3; it is made to your specifications (your design and vehicle name, never the licence plate). Subscriptions bought in the app are sold by Apple or Google; payment, receipts and cancellation then run through your Apple or Google account.',
          renewalRule('en', ctx),
          'Cancel any time via “Cancel contract here”, even without signing in. ParkShield does not replace emergency calls: in danger, call 110 or 112.',
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
          `You may withdraw from this contract within fourteen days without giving reasons by sending a clear statement to ${CONTACT}. You can also withdraw online with the “Withdraw from contract” button at the bottom of every page (§ 356a BGB); we confirm receipt by e-mail at once. If you asked for the service to start immediately, you pay a proportionate amount for the service provided until withdrawal. You do not need to send the decal back; its code is switched off for good.`,
          // TODO [LEGAL REVIEW] Part B (2026-11-22).
          'There is no right of withdrawal for the printed decal, because it is made to your specifications (§ 312g (2) no. 1 BGB); your right to withdraw from the subscription remains. If the decal was personalised and confirmed before your withdrawal, we keep its value (€3); the value of the days used is calculated pro rata from the rest. Subscriptions bought in the App Store or on Google Play are refunded by Apple or Google.',
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
});

/** The legal page `slug` in `locale`, for the renewal rule that is configured right now. */
export function legalDoc(
  locale: Locale,
  slug: LegalSlug,
  ctx: LegalContext = DEFAULT_LEGAL_CONTEXT,
): LegalDoc {
  return (locale === 'en' ? en : de)(ctx)[slug];
}

/** Renewal rule in one sentence, as shown at checkout and in e-mails. TODO [LEGAL REVIEW] */
export function renewalRule(locale: Locale, ctx: LegalContext = DEFAULT_LEGAL_CONTEXT): string {
  if (locale === 'en') {
    return ctx.renewalMode === 'annual'
      ? 'The contract runs for 12 months and renews by another 12 months unless you cancel before the end of the term. A cancellation takes effect at the end of the current 12-month period; there is no refund for the rest of the period.'
      : 'The first term is 12 months, paid in advance. Afterwards the contract continues month by month at the same price level (one twelfth of the annual price) and can be cancelled at any time to the end of the paid month.';
  }
  return ctx.renewalMode === 'annual'
    ? 'Der Vertrag läuft 12 Monate und verlängert sich um jeweils weitere 12 Monate, wenn Sie nicht vor Ablauf kündigen. Eine Kündigung wirkt zum Ende des laufenden 12-Monats-Zeitraums; für den Rest des Zeitraums gibt es keine Erstattung.'
    : 'Die erste Laufzeit beträgt 12 Monate und wird im Voraus bezahlt. Danach läuft der Vertrag monatlich zum gleichen Preisniveau weiter (ein Zwölftel des Jahrespreises) und ist jederzeit zum Ende des bezahlten Monats kündbar.';
}
