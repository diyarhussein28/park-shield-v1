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
  /** Page that solves it; account tasks point to /app (the portal is in the app since 2026-11-24). */
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
        'Wir benachrichtigen Sie sofort in der ParkShield-App; reagieren Sie nicht, folgen eine Erinnerung und nach 30 Minuten eine SMS. Die Person, die scannt, sieht weder Ihren Namen noch Ihre Telefonnummer noch Ihr Kennzeichen. Sie sieht nur den Spitznamen, den Sie Ihrem Auto gegeben haben.',
        'Mit einer Schnellantwort sagen Sie Bescheid, dass Sie kommen. Die Person sieht das auf ihrer Seite.',
      ],
    },
    en: {
      title: 'How ParkShield works',
      summary: 'A decal with a QR code and an alert to you – without anyone seeing your number.',
      body: [
        'You put the ParkShield decal clearly visible behind the windscreen. Anyone who notices a problem with your car scans the QR code with their phone and picks what is wrong, for example “Lights are still on” or “Vehicle is blocking an exit”.',
        'We notify you at once in the ParkShield app; if you do not respond, a reminder and after 30 minutes an SMS follow. The person who scans sees neither your name nor your phone number nor your licence plate. They only see the nickname you gave your car.',
        'With a quick reply you let them know you are on your way. They see it on their page.',
      ],
    },
  },
  {
    slug: 'aufkleber-testen',
    category: 'start',
    action: { href: '/app', de: 'Zur ParkShield-App', en: 'Get the ParkShield app' },
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
    // Slug kept from the web-push article (links); alerts arrive only through the app since 2026-11-21.
    slug: 'push-auf-dem-iphone',
    category: 'alerts',
    action: { href: '/app', de: 'Zur ParkShield-App', en: 'Get the ParkShield app' },
    de: {
      title: 'Mitteilungen auf dem iPhone',
      summary:
        'Warnungen kommen als Mitteilung der ParkShield-App. So stellen Sie sicher, dass sie ankommen.',
      body: [
        'Installieren Sie die ParkShield-App aus dem App Store, melden Sie sich an und tippen Sie auf „Erlauben“, wenn die App nach Mitteilungen fragt.',
        'Haben Sie das abgelehnt, öffnen Sie Einstellungen → Mitteilungen → ParkShield und schalten Sie „Mitteilungen erlauben“ ein. Prüfen Sie auch, dass ein Fokus-Modus ParkShield nicht stummschaltet.',
        'Sind Mitteilungen aus, erfahren Sie von einer Warnung erst nach 30 Minuten per SMS. Unter „Benachrichtigungen“ im Konto sehen Sie, ob Ihr Handy verbunden ist.',
      ],
    },
    en: {
      title: 'Notifications on an iPhone',
      summary:
        'Alerts arrive as ParkShield app notifications. Here is how to make sure they get through.',
      body: [
        'Install the ParkShield app from the App Store, sign in and tap “Allow” when the app asks about notifications.',
        'If you declined, open Settings → Notifications → ParkShield and turn on “Allow Notifications”. Also check that a Focus mode does not silence ParkShield.',
        'With notifications off, you only hear about an alert after 30 minutes, by SMS. Under “Notifications” in your account you can see whether your phone is connected.',
      ],
    },
  },
  {
    slug: 'app-einrichten',
    category: 'alerts',
    action: { href: '/app', de: 'Zur ParkShield-App', en: 'Get the ParkShield app' },
    de: {
      title: 'Die ParkShield-App einrichten',
      summary:
        'App installieren, mit Ihrer E-Mail anmelden, Mitteilungen erlauben. Fotos und Chat gibt es direkt in der App.',
      body: [
        'Laden Sie die ParkShield-App aus dem App Store oder von Google Play. Sie melden sich mit derselben E-Mail-Adresse an wie im Kundenportal; wir schicken Ihnen einen Anmeldelink.',
        'Erlauben Sie Mitteilungen, wenn die App fragt. Ohne Mitteilungen erfahren Sie nicht sofort von Problemen an Ihrem Fahrzeug. Die Mitteilung enthält nur die Art der Warnung; alles Weitere lädt die App sicher von unseren Servern.',
        'Mit „Ich komme“ direkt in der Mitteilung oder in der App sagen Sie Bescheid. In der App können Sie der Person am Fahrzeug auch eine kurze Rückfrage stellen.',
      ],
    },
    en: {
      title: 'Setting up the ParkShield app',
      summary:
        'Install the app, sign in with your e-mail, allow notifications. Photos and chat are right in the app.',
      body: [
        'Get the ParkShield app from the App Store or Google Play. You sign in with the same e-mail address as in the customer portal; we send you a sign-in link.',
        'Allow notifications when the app asks. Without notifications you do not learn about problems with your vehicle right away. The notification contains only the type of alert; the app loads everything else securely from our servers.',
        'Tap “I’m coming” right in the notification or in the app. In the app you can also ask the person at the vehicle a short question.',
      ],
    },
  },
  {
    slug: 'warnung-nicht-bekommen',
    category: 'alerts',
    action: { href: '/app', de: 'Zur ParkShield-App', en: 'Get the ParkShield app' },
    de: {
      title: 'Ich habe eine Warnung nicht bekommen',
      summary: 'Unsere Zustellungsprüfung zeigt, was wann versucht wurde.',
      body: [
        'Öffnen Sie im Konto „Warnung nicht bekommen?“. Dort sehen Sie die letzten Zustellversuche mit Ergebnis, ohne den Inhalt der Nachrichten.',
        'Häufige Gründe: Die ParkShield-App ist nicht angemeldet oder Mitteilungen sind aus, eine Ruhezeit oder ein vorübergehender Modus war aktiv, oder Ihre Handynummer ist nicht bestätigt.',
        'Prüfen Sie App und Handynummer und testen Sie den Aufkleber erneut. Hilft das nicht, schreiben Sie uns über das Kontaktformular.',
      ],
    },
    en: {
      title: 'I did not get an alert',
      summary: 'Our delivery check shows what was tried and when.',
      body: [
        'Open “Didn’t get the alert?” in your account. It shows the latest delivery attempts with their result, never the content of messages.',
        'Common reasons: the ParkShield app is not signed in or notifications are off, quiet hours or a temporary mode were on, or your mobile number is not verified.',
        'Check the app and your mobile number and test your decal again. If that does not help, write to us using the contact form.',
      ],
    },
  },
  {
    slug: 'ruhezeiten-und-modi',
    category: 'alerts',
    action: { href: '/app', de: 'Zur ParkShield-App', en: 'Get the ParkShield app' },
    de: {
      title: 'Ruhezeiten, „Sensibler Ort“ und „Kurzer Halt“',
      summary: 'Nachts in Ruhe, dringende Warnungen kommen trotzdem per App.',
      body: [
        'In Ruhezeiten halten wir normale Warnungen zurück. Dringende Warnungen wie „Fahrzeug versperrt Ausfahrt“ oder „Abschleppen droht“ kommen weiter als App-Mitteilung, wenn Sie das so lassen. Eine SMS schicken wir in Ruhezeiten nie.',
        '„Sensibler Ort“ ist ein vorübergehender Modus für Kino oder Besprechung: Nur Dringendes erreicht Sie. „Kurzer Halt“ zeigt Personen, die scannen, wann Sie zurück sind.',
        'Beide Modi enden automatisch, spätestens nach 12 Stunden.',
      ],
    },
    en: {
      title: 'Quiet hours, “Sensitive spot” and “Short stop”',
      summary: 'Peace at night, urgent alerts still come through the app.',
      body: [
        'During quiet hours we hold back normal alerts. Urgent ones such as “Vehicle is blocking an exit” or “Vehicle is about to be towed” still come through as an app notification unless you change that. We never send an SMS during quiet hours.',
        '“Sensitive spot” is a temporary mode for the cinema or a meeting: only urgent alerts reach you. “Short stop” shows people who scan when you will be back.',
        'Both modes end automatically, after 12 hours at the latest.',
      ],
    },
  },
  {
    slug: 'erinnerung-und-sms',
    category: 'alerts',
    action: { href: '/app', de: 'Zur ParkShield-App', en: 'Get the ParkShield app' },
    de: {
      title: 'Wenn Sie nicht reagieren: Erinnerung und SMS',
      summary: 'Nach 10 Minuten eine Erinnerung in der App, nach 30 Minuten eine einzige SMS.',
      body: [
        'Jede Warnung kommt sofort als Mitteilung der ParkShield-App. Reagieren Sie 10 Minuten lang nicht, erinnert Sie die App ein zweites Mal.',
        'Reagieren Sie 30 Minuten lang nicht, schicken wir eine SMS an Ihre bestätigte Handynummer, pro Warnung höchstens eine. In Ruhezeiten und bei Tests gibt es keine SMS.',
        'Sobald Sie „Ich komme“ tippen, antworten, den Chat öffnen, den Absender blockieren oder die Warnung erledigen, stoppen Erinnerung und SMS. Nur das Ansehen der Warnung reicht dafür nicht.',
      ],
    },
    en: {
      title: 'If you do not respond: reminder and SMS',
      summary: 'A reminder in the app after 10 minutes, one single SMS after 30 minutes.',
      body: [
        'Every alert arrives at once as a ParkShield app notification. If you do not respond for 10 minutes, the app reminds you a second time.',
        'If you do not respond for 30 minutes, we send an SMS to your verified mobile number, at most one per alert. There is no SMS during quiet hours or for tests.',
        'As soon as you tap “I’m coming”, reply, open the chat, block the sender or mark the alert as done, the reminder and the SMS stop. Just viewing the alert is not enough.',
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
        'Jede Antwort stoppt die Erinnerung und die SMS zu dieser Warnung.',
        '„Ich komme“ funktioniert direkt in der App-Mitteilung und in der App.',
      ],
    },
    en: {
      title: 'Quick replies: “I’m coming”',
      summary: 'One tap tells the person, without typing a word.',
      body: [
        'Every alert comes with reply buttons: “I’m coming”, “In 30 minutes” and “Not nearby”. The person who scanned sees your reply on their page at once.',
        'Any reply stops the reminder and the SMS for this alert.',
        '“I’m coming” works right in the app notification and in the app.',
      ],
    },
  },
  {
    slug: 'aufkleber-bestellen-und-versand',
    category: 'decal',
    de: {
      title: 'Aufkleber drucken oder zusenden lassen',
      summary:
        'Der erste gedruckte Aufkleber mit Versand ist im Abo enthalten; selbst drucken ist immer kostenlos.',
      body: [
        'Im Fahrzeug finden Sie unter „Aufkleber drucken“ zwei Wege: „Selbst drucken – kostenlos“ (PDF 80 × 80 mm mit Schnittmarken, PNG oder SVG) und „Drucken und zusenden lassen“.',
        'Der erste zugesandte Aufkleber ist kostenlos (Willkommensdruck). Jeder weitere kostet 3 € einmalig inklusive Mehrwertsteuer und Versand. Er kommt in der Regel innerhalb weniger Werktage; die Sendungsnummer schicken wir Ihnen per E-Mail.',
        'Normales Papier hält Sonne, Regen und Waschanlage nicht lange stand. Wir empfehlen wetterfeste Polyester-Etiketten für Laserdrucker.',
      ],
    },
    en: {
      title: 'Printing your decal or having it sent',
      summary:
        'The first printed decal with shipping is included; printing it yourself is always free.',
      body: [
        'In your vehicle, “Print your decal” offers two ways: “Print it yourself – free” (PDF 80 × 80 mm with cut marks, PNG or SVG) and “Have it printed and sent”.',
        'The first decal we send is free (welcome print). Each further one costs €3 once, VAT and shipping included. It usually arrives within a few working days; we e-mail you the tracking number.',
        'Ordinary paper does not stand up to sun, rain and car washes for long. We recommend weatherproof polyester labels for laser printers.',
      ],
    },
  },
  {
    slug: 'ersatzaufkleber-und-code-sperren',
    category: 'decal',
    de: {
      title: 'Code sperren und neuen Code erstellen',
      summary: 'Aufkleber verloren, Auto verkauft oder zu viele Fehlalarme? Sperren Sie den Code.',
      body: [
        'Im Fahrzeug tippen Sie auf „Sperren“ und bestätigen. Der alte Aufkleber funktioniert sofort nicht mehr. Ein neuer Code wird dabei nicht automatisch erstellt; Ihr Fahrzeug zeigt dann „Kein aktiver Code“.',
        'Mit „Neuen Code erstellen“ bekommen Sie kostenlos einen neuen Code mit Ihrer bisherigen Gestaltung. Selbst drucken ist kostenlos, drucken und zusenden lassen kostet 3 € einmalig.',
        'Haben wir einen Ersatz für Sie freigeschaltet, ist auch das Zusenden kostenlos.',
      ],
    },
    en: {
      title: 'Blocking a code and creating a new one',
      summary: 'Lost the decal, sold the car, too many false alarms? Block the code.',
      body: [
        'In your vehicle, tap “Block” and confirm. The old decal stops working at once. No new code is created automatically; your vehicle then shows “No active code”.',
        '“Create a new code” gives you a new code with your previous design, free of charge. Printing it yourself is free; having it printed and sent costs €3 once.',
        'If we have granted you a replacement, sending it is free too.',
      ],
    },
  },
  {
    slug: 'vorgedruckter-aufkleber-aktivieren',
    category: 'decal',
    action: { href: '/app', de: 'Zur ParkShield-App', en: 'Get the ParkShield app' },
    de: {
      title: 'Aufkleber von der Hausverwaltung einrichten',
      summary:
        'Vorgedruckte Aufkleber von Partnern richten Sie mit dem Code in wenigen Schritten ein.',
      body: [
        'Manche Hausverwaltungen und Partner verteilen ParkShield-Aufkleber. Scannen Sie den Aufkleber selbst; die Seite bietet Ihnen „Aufkleber einrichten“ an und öffnet dafür die ParkShield-App. Den Code finden Sie auch unter dem QR-Code.',
        'Melden Sie sich in der App an und schließen Sie das Abo ab.',
        'Wählen Sie das Fahrzeug, an dem der Aufkleber klebt, und testen Sie ihn einmal. Ein älterer Code dieses Fahrzeugs wird dabei ersetzt.',
      ],
    },
    en: {
      title: 'Setting up a decal from your property manager',
      summary: 'Pre-printed decals from partners are set up with the code in a few steps.',
      body: [
        'Some property managers and partners hand out ParkShield decals. Scan the decal yourself; the page offers “Set up decal” and opens the ParkShield app for it. The code is also printed below the QR code.',
        'Sign in to the app and subscribe.',
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
    action: { href: '/app', de: 'Zur ParkShield-App', en: 'Get the ParkShield app' },
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
    action: { href: '/app', de: 'Zur ParkShield-App', en: 'Get the ParkShield app' },
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
      title: 'Abo und Preis',
      summary: 'ParkShield kostet 19,99 € im Jahr inklusive Mehrwertsteuer, alles inklusive.',
      body: [
        'ParkShield kostet 19,99 € pro Jahr und gilt für 1 Fahrzeug. Enthalten sind die Mitteilungen der App, die Erinnerung nach 10 Minuten, eine SMS nach 30 Minuten ohne Reaktion, Fotos bei Warnungen, der anonyme Chat und ein gedruckter Aufkleber mit Versand.',
        'Bezahlen können Sie mit Karte, SEPA-Lastschrift, PayPal oder Apple Pay. Die Rechnung finden Sie im Konto.',
        'Das Abo verlängert sich jeweils um ein Jahr, wenn Sie nicht vor Ende der Laufzeit kündigen.',
      ],
    },
    en: {
      title: 'Subscription and price',
      summary: 'ParkShield costs €19.99 a year including VAT, everything included.',
      body: [
        'ParkShield costs €19.99 a year and covers 1 vehicle. It includes app notifications, a reminder after 10 minutes, one SMS after 30 minutes without a response, photos with alerts, the anonymous chat and one printed decal with shipping.',
        'You can pay by card, SEPA direct debit, PayPal or Apple Pay. The invoice is in your account.',
        'The subscription renews for one year at a time unless you cancel before the end of the term.',
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
    action: { href: '/app', de: 'Zur ParkShield-App', en: 'Get the ParkShield app' },
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
