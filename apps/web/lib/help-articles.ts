import type { Locale } from '@parkshield/i18n';

export const HELP_CATEGORIES = ['start', 'alerts', 'decal', 'billing', 'privacy'] as const;
export type HelpCategory = (typeof HELP_CATEGORIES)[number];

interface Text {
  title: string;
  summary: string;
  body: string[];
}
export interface HelpArticle {
  slug: string;
  category: HelpCategory;
  /** In-app page that solves it, e.g. the delivery check. */
  action?: { href: string; de: string; en: string };
  de: Text;
  en: Text;
}

/** SP-01: 20 help articles at launch, German and English. Plain language, no legal advice. */
export const HELP_ARTICLES: HelpArticle[] = [
  {
    slug: 'so-funktioniert-parkshield',
    category: 'start',
    de: {
      title: 'So funktioniert ParkShield',
      summary:
        'Ein Aufkleber mit QR-Code, eine Warnung an Sie – ohne dass jemand Ihre Nummer sieht.',
      body: [
        'Sie kleben den ParkShield-Aufkleber gut sichtbar hinter die Windschutzscheibe. Wer ein Problem an Ihrem Auto bemerkt, scannt den QR-Code mit dem Handy und wählt aus, was los ist, zum Beispiel „Licht brennt noch“ oder „Fahrzeug versperrt Ausfahrt“.',
        'Wir benachrichtigen Sie sofort über Push, E-Mail oder WhatsApp. Die Person, die scannt, sieht weder Ihren Namen noch Ihre Telefonnummer noch Ihr Kennzeichen. Sie sieht nur den Spitznamen, den Sie Ihrem Auto gegeben haben.',
        'Mit einer Schnellantwort sagen Sie Bescheid, dass Sie kommen. Die Person sieht das auf ihrer Seite.',
      ],
    },
    en: {
      title: 'How ParkShield works',
      summary: 'A decal with a QR code and an alert to you – without anyone seeing your number.',
      body: [
        'You put the ParkShield decal clearly visible behind the windscreen. Anyone who notices a problem with your car scans the QR code with their phone and picks what is wrong, for example “Lights are still on” or “Vehicle is blocking an exit”.',
        'We notify you at once by push, e-mail or WhatsApp. The person who scans sees neither your name nor your phone number nor your licence plate. They only see the nickname you gave your car.',
        'With a quick reply you let them know you are on your way. They see it on their page.',
      ],
    },
  },
  {
    slug: 'aufkleber-testen',
    category: 'start',
    action: { href: '/konto/fahrzeuge', de: 'Zu Ihren Fahrzeugen', en: 'Go to your vehicles' },
    de: {
      title: 'Aufkleber testen',
      summary: 'Einmal selbst scannen: So wissen Sie sicher, dass Warnungen ankommen.',
      body: [
        'Öffnen Sie im Konto Ihr Fahrzeug und tippen Sie auf „Aufkleber testen“. Für die nächsten Minuten ist der nächste Scan Ihres Aufklebers ein Test.',
        'Scannen Sie den Aufkleber mit dem Handy und wählen Sie eine beliebige Warnung. Sie bekommen eine Test-Benachrichtigung, niemand sonst.',
        'Erst nach dem ersten Test ist Ihr Aufkleber aktiv. Wir erinnern Sie, falls Sie den Test vergessen.',
      ],
    },
    en: {
      title: 'Testing your decal',
      summary: 'Scan it once yourself, so you know for sure that alerts reach you.',
      body: [
        'Open your vehicle in your account and tap “Test decal”. For the next few minutes, the next scan of your decal is a test.',
        'Scan the decal with your phone and pick any alert. You get a test notification, nobody else does.',
        'Your decal is active after the first test. We remind you if you forget it.',
      ],
    },
  },
  {
    slug: 'aufkleber-anbringen',
    category: 'decal',
    de: {
      title: 'Wo klebe ich den Aufkleber hin?',
      summary: 'Innen an die Windschutzscheibe, gut sichtbar von außen, nicht im Sichtfeld.',
      body: [
        'Der UV-beständige Aufkleber haftet innen an der Scheibe und ist von außen lesbar. Gut geeignet ist die untere Ecke auf der Beifahrerseite. Halten Sie Abstand zum Sichtfeld und zu Sensoren hinter der Scheibe.',
        'Reinigen Sie die Stelle vorher mit etwas Glasreiniger und lassen Sie sie trocknen. Streichen Sie den Aufkleber von der Mitte nach außen glatt.',
        'Die Dashboard-Karte legen Sie einfach auf das Armaturenbrett. Testen Sie danach einmal mit „Aufkleber testen“.',
      ],
    },
    en: {
      title: 'Where do I put the decal?',
      summary:
        'On the inside of the windscreen, clearly visible from outside, out of your line of sight.',
      body: [
        'The UV-resistant decal sticks to the inside of the glass and can be read from outside. The lower corner on the passenger side works well. Keep it away from your line of sight and from sensors behind the windscreen.',
        'Clean the spot with a little glass cleaner first and let it dry. Smooth the decal from the centre outwards.',
        'Simply put the dashboard card on the dashboard. Then test it once with “Test decal”.',
      ],
    },
  },
  {
    slug: 'push-auf-dem-iphone',
    category: 'alerts',
    action: {
      href: '/konto/benachrichtigungen',
      de: 'Benachrichtigungen einrichten',
      en: 'Set up notifications',
    },
    de: {
      title: 'Push-Benachrichtigungen auf dem iPhone',
      summary: 'Auf dem iPhone funktioniert Push nur, wenn ParkShield auf dem Home-Bildschirm ist.',
      body: [
        'Öffnen Sie parkshield.de in Safari, tippen Sie auf „Teilen“ und dann auf „Zum Home-Bildschirm“. Öffnen Sie ParkShield danach über das neue Symbol und melden Sie sich an.',
        'Gehen Sie in den Benachrichtigungen auf „Dieses Gerät hinzufügen“ und erlauben Sie Mitteilungen. Ohne den Weg über den Home-Bildschirm bietet iOS keine Web-Push-Nachrichten an.',
        'Prüfen Sie zusätzlich, dass der Fokus-Modus ParkShield nicht stummschaltet. Als zweiten Kanal empfehlen wir WhatsApp oder E-Mail.',
      ],
    },
    en: {
      title: 'Push notifications on an iPhone',
      summary: 'On an iPhone, push only works when ParkShield is on the home screen.',
      body: [
        'Open parkshield.de in Safari, tap “Share” and then “Add to Home Screen”. Then open ParkShield from the new icon and sign in.',
        'In notifications, choose “Add this device” and allow notifications. Without the home screen step, iOS does not offer web push.',
        'Also check that a Focus mode does not silence ParkShield. We recommend WhatsApp or e-mail as a second channel.',
      ],
    },
  },
  {
    slug: 'whatsapp-einrichten',
    category: 'alerts',
    action: { href: '/konto/benachrichtigungen', de: 'WhatsApp verbinden', en: 'Connect WhatsApp' },
    de: {
      title: 'WhatsApp als Kanal einrichten',
      summary:
        'Nummer eingeben, Code bestätigen, fertig. Im Plus-Tarif sind 10 WhatsApp-Warnungen im Monat enthalten.',
      body: [
        'Geben Sie in den Benachrichtigungen Ihre Handynummer ein. Wir schicken Ihnen per WhatsApp einen Bestätigungscode, den Sie im Konto eingeben.',
        'Warnungen kommen danach als WhatsApp-Nachricht mit Antwort-Knöpfen. Ein Tipp auf „Ich komme“ genügt.',
        'Wenn das Monatskontingent aufgebraucht ist, kommen Warnungen weiter über Push und E-Mail. Wir sagen Ihnen vorher Bescheid.',
      ],
    },
    en: {
      title: 'Setting up WhatsApp',
      summary:
        'Enter your number, confirm the code, done. Plus includes 10 WhatsApp alerts a month.',
      body: [
        'Enter your mobile number in notifications. We send you a confirmation code by WhatsApp, which you enter in your account.',
        'From then on, alerts arrive as WhatsApp messages with reply buttons. One tap on “I’m coming” is enough.',
        'When the monthly allowance is used up, alerts keep coming by push and e-mail. We let you know beforehand.',
      ],
    },
  },
  {
    slug: 'warnung-nicht-bekommen',
    category: 'alerts',
    action: { href: '/konto/zustellung', de: 'Zustellung prüfen', en: 'Check delivery' },
    de: {
      title: 'Ich habe eine Warnung nicht bekommen',
      summary: 'Unsere Zustellungsprüfung zeigt, welcher Kanal wann versucht wurde.',
      body: [
        'Öffnen Sie im Konto „Warnung nicht bekommen?“. Dort sehen Sie die letzten Zustellversuche mit Kanal und Ergebnis, ohne den Inhalt der Nachrichten.',
        'Häufige Gründe: Push ist auf diesem Gerät nicht eingerichtet, eine Ruhezeit oder ein vorübergehender Modus war aktiv, oder die E-Mail liegt im Spam-Ordner.',
        'Richten Sie mindestens zwei Kanäle ein und testen Sie den Aufkleber erneut. Hilft das nicht, schreiben Sie uns über das Kontaktformular.',
      ],
    },
    en: {
      title: 'I did not get an alert',
      summary: 'Our delivery check shows which channel was tried and when.',
      body: [
        'Open “Didn’t get the alert?” in your account. It shows the latest delivery attempts with channel and result, never the content of messages.',
        'Common reasons: push is not set up on this device, quiet hours or a temporary mode were on, or the e-mail is in the spam folder.',
        'Set up at least two channels and test your decal again. If that does not help, write to us using the contact form.',
      ],
    },
  },
  {
    slug: 'ruhezeiten-und-modi',
    category: 'alerts',
    action: {
      href: '/konto/benachrichtigungen',
      de: 'Ruhezeiten einstellen',
      en: 'Set quiet hours',
    },
    de: {
      title: 'Ruhezeiten, „Sensibler Ort“ und „Kurzer Halt“',
      summary: 'Nachts in Ruhe, dringende Warnungen kommen trotzdem.',
      body: [
        'In Ruhezeiten halten wir normale Warnungen zurück. Dringende Warnungen wie „Fahrzeug versperrt Ausfahrt“ oder „Abschleppen droht“ kommen weiter, wenn Sie das so lassen.',
        '„Sensibler Ort“ ist ein vorübergehender Modus für Kino oder Besprechung: Nur Dringendes erreicht Sie. „Kurzer Halt“ zeigt Personen, die scannen, wann Sie zurück sind.',
        'Beide Modi enden automatisch, spätestens nach 12 Stunden.',
      ],
    },
    en: {
      title: 'Quiet hours, “Sensitive spot” and “Short stop”',
      summary: 'Peace at night, urgent alerts still come through.',
      body: [
        'During quiet hours we hold back normal alerts. Urgent ones such as “Vehicle is blocking an exit” or “Vehicle is about to be towed” still come through unless you change that.',
        '“Sensitive spot” is a temporary mode for the cinema or a meeting: only urgent alerts reach you. “Short stop” shows people who scan when you will be back.',
        'Both modes end automatically, after 12 hours at the latest.',
      ],
    },
  },
  {
    slug: 'notfallkontakt',
    category: 'alerts',
    action: {
      href: '/konto/notfallkontakte',
      de: 'Notfallkontakt einladen',
      en: 'Invite an emergency contact',
    },
    de: {
      title: 'Notfallkontakt: wenn Sie nicht reagieren',
      summary:
        'Eine Person Ihres Vertrauens wird benachrichtigt, wenn Sie bei Dringendem nicht antworten.',
      body: [
        'Laden Sie im Konto eine Person ein. Sie bekommt eine E-Mail und muss zustimmen, bevor wir sie je benachrichtigen.',
        'Antworten Sie auf eine dringende Warnung nicht innerhalb der eingestellten Zeit, informieren wir Ihren Notfallkontakt. Ihre Nummer oder Adresse geben wir dabei nicht weiter.',
        'Sie können den Kontakt jederzeit entfernen; der Kontakt kann seine Zustimmung ebenso jederzeit zurückziehen.',
      ],
    },
    en: {
      title: 'Emergency contact: when you do not respond',
      summary: 'Someone you trust is notified when you do not answer an urgent alert.',
      body: [
        'Invite a person in your account. They get an e-mail and must agree before we ever notify them.',
        'If you do not answer an urgent alert within the time you set, we inform your emergency contact. We never pass on your number or address.',
        'You can remove the contact at any time; the contact can withdraw their consent at any time too.',
      ],
    },
  },
  {
    slug: 'schnellantworten',
    category: 'alerts',
    de: {
      title: 'Schnellantworten: „Ich komme“',
      summary: 'Mit einem Tipp sagen Sie der Person Bescheid, ohne ein Wort zu tippen.',
      body: [
        'Jede Warnung kommt mit Antwort-Knöpfen: „Ich komme“, „In 30 Minuten“ und „Bin nicht in der Nähe“. Die Person, die gescannt hat, sieht Ihre Antwort sofort auf ihrer Seite.',
        'Bei „Bin nicht in der Nähe“ informieren wir auf Wunsch Ihren Notfallkontakt.',
        'Die Knöpfe funktionieren in der Push-Nachricht, in WhatsApp und in der E-Mail.',
      ],
    },
    en: {
      title: 'Quick replies: “I’m coming”',
      summary: 'One tap tells the person, without typing a word.',
      body: [
        'Every alert comes with reply buttons: “I’m coming”, “In 30 minutes” and “Not nearby”. The person who scanned sees your reply on their page at once.',
        'With “Not nearby” we inform your emergency contact if you want us to.',
        'The buttons work in the push notification, in WhatsApp and in the e-mail.',
      ],
    },
  },
  {
    slug: 'aufkleber-bestellen-und-versand',
    category: 'decal',
    de: {
      title: 'Aufkleber bestellen und Versand',
      summary:
        'Ein gedruckter Aufkleber ist im Abo enthalten; bis er da ist, drucken Sie ihn selbst aus.',
      body: [
        'Nach dem Kauf gestalten Sie Ihren Aufkleber im Konto und bestellen den enthaltenen Druck. Er kommt in der Regel innerhalb weniger Werktage per Post; die Sendungsnummer schicken wir Ihnen per E-Mail.',
        'Bis dahin können Sie den Aufkleber jederzeit kostenlos als PDF ausdrucken.',
        'Kommt die Sendung zurück, melden wir uns bei Ihnen und schicken ihn kostenlos noch einmal.',
      ],
    },
    en: {
      title: 'Ordering a decal and shipping',
      summary: 'One printed decal is included; until it arrives, you print it yourself.',
      body: [
        'After buying, you design your decal in your account and order the included print. It usually arrives by post within a few working days; we e-mail you the tracking number.',
        'Until then you can print the decal as a PDF for free at any time.',
        'If the parcel comes back, we get in touch and send it again free of charge.',
      ],
    },
  },
  {
    slug: 'ersatzaufkleber-und-code-sperren',
    category: 'decal',
    de: {
      title: 'Code sperren und Ersatzaufkleber',
      summary:
        'Aufkleber verloren, Auto verkauft oder zu viele Fehlalarme? Ein neuer Code in Sekunden.',
      body: [
        'Im Fahrzeug tippen Sie auf „Code sperren und neu ausstellen“. Der alte Aufkleber zeigt ab sofort nur noch „nicht aktiv“.',
        'Den neuen Code drucken Sie als PDF aus oder bestellen einen Ersatzaufkleber für 5,90 € inklusive Versand.',
        'Haben wir den Code zu Ihrem Schutz gesperrt, ist der Ersatz für Sie kostenlos.',
      ],
    },
    en: {
      title: 'Revoking a code and replacement decals',
      summary: 'Lost the decal, sold the car, too many false alarms? A new code in seconds.',
      body: [
        'In your vehicle, tap “Revoke code and issue a new one”. From then on, the old decal only shows “not active”.',
        'Print the new code as a PDF or order a replacement decal for €5.90 including shipping.',
        'If we revoked the code to protect you, the replacement is free.',
      ],
    },
  },
  {
    slug: 'vorgedruckter-aufkleber-aktivieren',
    category: 'decal',
    action: { href: '/aktivieren', de: 'Aufkleber einrichten', en: 'Set up a decal' },
    de: {
      title: 'Aufkleber von der Hausverwaltung einrichten',
      summary:
        'Vorgedruckte Aufkleber von Partnern richten Sie mit dem Code in wenigen Schritten ein.',
      body: [
        'Manche Hausverwaltungen und Partner verteilen ParkShield-Aufkleber. Scannen Sie den Aufkleber selbst; die Seite bietet Ihnen „Aufkleber einrichten“ an. Den Code finden Sie auch unter dem QR-Code.',
        'Melden Sie sich an und buchen Sie Plus. Ein Gutscheincode des Partners wird dabei automatisch eingetragen.',
        'Wählen Sie das Fahrzeug, an dem der Aufkleber klebt, und testen Sie ihn einmal. Ein älterer Code dieses Fahrzeugs wird dabei ersetzt.',
      ],
    },
    en: {
      title: 'Setting up a decal from your property manager',
      summary: 'Pre-printed decals from partners are set up with the code in a few steps.',
      body: [
        'Some property managers and partners hand out ParkShield decals. Scan the decal yourself; the page offers “Set up decal”. The code is also printed below the QR code.',
        'Sign in and buy Plus. A partner promo code is filled in automatically.',
        'Choose the vehicle the decal is on and test it once. An older code of this vehicle is replaced.',
      ],
    },
  },
  {
    slug: 'was-sieht-der-finder',
    category: 'privacy',
    de: {
      title: 'Was sieht die Person, die scannt?',
      summary: 'Nur den Spitznamen Ihres Autos und die Farbe – nie Name, Nummer oder Kennzeichen.',
      body: [
        'Die Scan-Seite zeigt den Spitznamen, den Sie vergeben haben, und optional die Farbe. Sie braucht kein Konto und setzt keine Cookies.',
        'Von der Person speichern wir keine IP-Adresse, nur für 24 Stunden eine verschlüsselte Kennung, um Missbrauch zu begrenzen.',
        'Freitexte prüft ein Filter auf Beleidigungen und Drohungen, bevor sie Sie erreichen. Nach 7 Tagen löschen wir sie.',
      ],
    },
    en: {
      title: 'What does the person who scans see?',
      summary: 'Only your car’s nickname and colour – never name, number or plate.',
      body: [
        'The scan page shows the nickname you chose and, optionally, the colour. It needs no account and sets no cookies.',
        'We store no IP address of the person, only an encrypted reference for 24 hours to limit abuse.',
        'A filter checks free text for insults and threats before it reaches you. We delete it after 7 days.',
      ],
    },
  },
  {
    slug: 'missbrauch-melden',
    category: 'privacy',
    action: { href: '/konto/verlauf', de: 'Zum Verlauf', en: 'Go to history' },
    de: {
      title: 'Belästigung oder Missbrauch melden',
      summary: 'Eine Meldung im Verlauf sperrt diese Person 30 Tage lang für Ihr Fahrzeug.',
      body: [
        'Öffnen Sie im Konto den Verlauf und tippen Sie bei der Warnung auf „Missbrauch melden“. Diese Person kann Ihr Fahrzeug danach 30 Tage lang nicht mehr benachrichtigen.',
        'Unser Team sieht auffällige Muster, etwa sehr viele Warnungen in kurzer Zeit, und kann den Code zu Ihrem Schutz sperren. Der Ersatzaufkleber ist dann kostenlos.',
        'Bei Drohungen wenden Sie sich bitte auch an die Polizei.',
      ],
    },
    en: {
      title: 'Reporting harassment or abuse',
      summary: 'A report in your history blocks that person for your vehicle for 30 days.',
      body: [
        'Open your history and tap “Report abuse” on the alert. That person cannot notify your vehicle for 30 days.',
        'Our team sees unusual patterns, such as very many alerts in a short time, and can revoke the code to protect you. The replacement decal is then free.',
        'For threats, please also contact the police.',
      ],
    },
  },
  {
    slug: 'daten-herunterladen-und-konto-loeschen',
    category: 'privacy',
    action: { href: '/konto/daten', de: 'Daten und Konto', en: 'Data and account' },
    de: {
      title: 'Daten herunterladen oder Konto löschen',
      summary: 'Alle Ihre Daten als JSON oder PDF, und die Löschung mit 24 Stunden Bedenkzeit.',
      body: [
        'Unter „Daten herunterladen oder Konto löschen“ laden Sie alles herunter, was wir über Sie speichern. Zur Sicherheit fragen wir nach einer frischen Anmeldung.',
        'Wenn Sie Ihr Konto löschen, sind Ihre Aufkleber sofort inaktiv. Nach 24 Stunden löschen wir Ihre Daten, auch bei unseren Dienstleistern. Bis dahin können Sie die Löschung per Link in der E-Mail abbrechen.',
        'Rechnungen müssen wir aus steuerlichen Gründen aufbewahren.',
      ],
    },
    en: {
      title: 'Downloading your data or deleting your account',
      summary: 'All your data as JSON or PDF, and deletion with 24 hours to change your mind.',
      body: [
        'Under “Download data or delete account” you download everything we store about you. For security, we ask you to sign in again first.',
        'When you delete your account, your decals stop working at once. After 24 hours we delete your data, including at our service providers. Until then you can cancel the deletion with the link in the e-mail.',
        'We have to keep invoices for tax reasons.',
      ],
    },
  },
  {
    slug: 'abo-und-preise',
    category: 'billing',
    de: {
      title: 'Abo und Preise',
      summary: 'Plus kostet 10 € im Jahr inklusive Mehrwertsteuer und einem gedruckten Aufkleber.',
      body: [
        'ParkShield Plus kostet 10 € pro Jahr und gilt für bis zu 2 Fahrzeuge. Enthalten sind Push und E-Mail ohne Limit, 10 WhatsApp-Warnungen im Monat, ein Notfallkontakt und ein gedruckter Aufkleber.',
        'Bezahlen können Sie mit Karte, SEPA-Lastschrift, PayPal oder Apple Pay. Die Rechnung finden Sie im Konto.',
        'Bei Fragen zu Plus antworten wir innerhalb von 48 Stunden.',
      ],
    },
    en: {
      title: 'Subscription and prices',
      summary: 'Plus costs €10 a year including VAT and one printed decal.',
      body: [
        'ParkShield Plus costs €10 a year and covers up to 2 vehicles. It includes unlimited push and e-mail, 10 WhatsApp alerts a month, one emergency contact and one printed decal.',
        'You can pay by card, SEPA direct debit, PayPal or Apple Pay. The invoice is in your account.',
        'We answer questions from Plus customers within 48 hours.',
      ],
    },
  },
  {
    slug: 'kuendigen',
    category: 'billing',
    action: { href: '/kuendigen', de: 'Verträge hier kündigen', en: 'Cancel contracts here' },
    de: {
      title: 'Kündigen',
      summary: 'Jederzeit, auch ohne Anmeldung, mit E-Mail-Adresse und Vertragsnummer.',
      body: [
        'Über „Verträge hier kündigen“ unten auf jeder Seite kündigen Sie in zwei Schritten. Angemeldet geht es direkt im Konto.',
        'Im ersten Jahr endet das Abo mit dem bezahlten Jahr. Nach einer Verlängerung können Sie jederzeit mit einem Monat Frist kündigen; den nicht genutzten Teil erstatten wir anteilig.',
        'Wir bestätigen die Kündigung sofort per E-Mail mit Eingangszeitpunkt.',
      ],
    },
    en: {
      title: 'Cancelling',
      summary:
        'At any time, also without signing in, with your e-mail address and contract number.',
      body: [
        'Use “Cancel contracts here” at the bottom of every page to cancel in two steps. When signed in, you can do it in your account.',
        'In the first year the subscription ends with the paid year. After a renewal you can cancel at any time with one month’s notice; we refund the unused part pro rata.',
        'We confirm the cancellation by e-mail at once, with the time we received it.',
      ],
    },
  },
  {
    slug: 'widerruf-und-erstattung',
    category: 'billing',
    action: { href: '/widerruf', de: 'Widerrufsbelehrung', en: 'Withdrawal policy' },
    de: {
      title: 'Widerruf und Erstattung',
      summary: '14 Tage Widerrufsrecht; bei sofortigem Start zahlen Sie nur die genutzten Tage.',
      body: [
        'Sie können den Vertrag innerhalb von 14 Tagen widerrufen. Weil Sie den sofortigen Start verlangt haben, ziehen wir den Wert der bereits genutzten Tage ab (Wertersatz).',
        'Ein individuell gestalteter, bereits gedruckter Aufkleber ist vom Widerruf ausgenommen; seinen Wert ziehen wir ebenfalls ab.',
        'Die Erstattung geht auf Ihr ursprüngliches Zahlungsmittel. Die Gutschrift finden Sie im Konto.',
      ],
    },
    en: {
      title: 'Withdrawal and refunds',
      summary: '14 days to withdraw; with the immediate start you only pay for the days used.',
      body: [
        'You can withdraw from the contract within 14 days. Because you asked for the immediate start, we deduct the value of the days already used.',
        'A custom-designed decal that has already been printed is excluded from withdrawal; we deduct its value too.',
        'The refund goes to your original payment method. You find the credit note in your account.',
      ],
    },
  },
  {
    slug: 'zahlungsmethode-und-rechnungen',
    category: 'billing',
    action: { href: '/konto', de: 'Zum Konto', en: 'Go to account' },
    de: {
      title: 'Zahlungsmethode ändern und Rechnungen',
      summary: 'Zahlungsmethode im Konto ändern, Rechnungen und Gutschriften als PDF.',
      body: [
        'Im Konto tippen Sie auf „Zahlungsmethode ändern“. Sie gelangen auf die sichere Seite unseres Zahlungsanbieters.',
        'Rechnungen und Gutschriften stehen im Konto als PDF bereit.',
        'Klappt eine Verlängerung nicht, bleibt Ihr Schutz zunächst aktiv. Wir versuchen es mehrmals und erinnern Sie per E-Mail.',
      ],
    },
    en: {
      title: 'Changing the payment method and invoices',
      summary: 'Change your payment method in your account; invoices and credit notes as PDF.',
      body: [
        'In your account, tap “Change payment method”. You go to the secure page of our payment provider.',
        'Invoices and credit notes are available as PDF in your account.',
        'If a renewal fails, your protection stays active for now. We try several times and remind you by e-mail.',
      ],
    },
  },
  {
    slug: 'gutscheincode',
    category: 'billing',
    de: {
      title: 'Gutscheincode einlösen',
      summary: 'Den Code geben Sie beim Kauf im Konto ein; der Rabatt gilt für das erste Jahr.',
      body: [
        'Im Konto finden Sie vor dem Kauf das Feld „Gutscheincode“. Der Preis mit Rabatt erscheint auf der Bezahlseite.',
        'Manche Codes schenken Ihnen zusätzliche Monate oder sichern den Preis für mehrere Jahre. Die Bedingungen nennt Ihnen, wer den Code ausgegeben hat.',
        'Ist ein Code abgelaufen oder aufgebraucht, sagen wir Ihnen das direkt beim Eingeben.',
      ],
    },
    en: {
      title: 'Redeeming a promo code',
      summary:
        'Enter the code in your account when buying; the discount applies to the first year.',
      body: [
        'Before buying, your account shows the “Promo code” field. The discounted price appears on the payment page.',
        'Some codes give you extra months or lock the price for several years. Whoever issued the code tells you the conditions.',
        'If a code has expired or is used up, we tell you right when you enter it.',
      ],
    },
  },
];

export const articleBySlug = (slug: string) => HELP_ARTICLES.find((a) => a.slug === slug);

/** Lower-case words of title, summary and body, for the search box. */
export const searchText = (a: HelpArticle, locale: Locale) =>
  [a[locale].title, a[locale].summary, ...a[locale].body].join(' ').toLowerCase();
