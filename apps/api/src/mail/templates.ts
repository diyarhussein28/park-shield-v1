import { IntlMessageFormat } from 'intl-messageformat';

export type MailLocale = 'de' | 'en';

interface TemplateSource {
  subject: string;
  lines: string[];
  action?: string;
}

const templates = {
  de: {
    magic_link: {
      subject: 'Ihr Anmeldelink für ParkShield',
      lines: [
        'Hallo,',
        'mit diesem Link melden Sie sich bei ParkShield an. Er ist 15 Minuten gültig und funktioniert nur einmal.',
        'Wenn Sie keinen Link angefordert haben, können Sie diese E-Mail ignorieren.',
      ],
      action: 'Jetzt anmelden',
    },
    new_device: {
      subject: 'Neue Anmeldung bei ParkShield',
      lines: [
        'Ihr Konto wurde am {when, date, long} um {when, time, short} auf einem neuen Gerät verwendet: {device}.',
        'Waren Sie das nicht? Melden Sie sich an und entfernen Sie unbekannte Geräte, oder antworten Sie auf diese E-Mail.',
      ],
    },
    subscription_started: {
      subject: 'Willkommen bei ParkShield {plan}',
      lines: [
        'Vielen Dank! Ihr Abo {plan} ist aktiv bis zum {periodEnd, date, long}.',
        'Ihre Vertragsnummer: {contractNo}. Sie brauchen sie, wenn Sie ohne Anmeldung kündigen möchten.',
        'Sie haben verlangt, dass die Leistung sofort beginnt. Bei einem Widerruf innerhalb von 14 Tagen zahlen Sie Wertersatz für die bis dahin erbrachte Leistung.',
        'Ihre Rechnung finden Sie in Ihrem Konto.',
      ],
      action: 'Zum Konto',
    },
    cancel_received: {
      subject: 'Ihre Kündigung ist eingegangen',
      lines: [
        'Wir haben Ihre Kündigung am {receivedAt, date, long} um {receivedAt, time, short} erhalten.',
        'Vertragsnummer: {contractNo}. Ihr Abo endet zum {endsAt, date, long}. Bis dahin bleibt Ihr Schutz aktiv.',
        'Sie müssen nichts weiter tun.',
      ],
    },
    cancel_not_found: {
      subject: 'Ihre Kündigung bei ParkShield',
      lines: [
        'Wir haben am {receivedAt, date, long} um {receivedAt, time, short} eine Kündigung für diese E-Mail-Adresse erhalten.',
        'Zur angegebenen Vertragsnummer haben wir keinen aktiven Vertrag gefunden. Bitte prüfen Sie die Vertragsnummer in Ihrer Willkommens-E-Mail oder antworten Sie auf diese E-Mail.',
      ],
    },
    waitlist_confirm: {
      subject: 'Bitte bestätigen Sie Ihre Anmeldung zur Business-Warteliste',
      lines: [
        'Sie haben {company} für die Warteliste von ParkShield Business eingetragen.',
        'Bitte bestätigen Sie die Anmeldung. Ohne Bestätigung löschen wir die Angaben nach 30 Tagen.',
      ],
      action: 'Anmeldung bestätigen',
    },
    payment_failed: {
      subject: 'Ihre Zahlung für ParkShield hat nicht geklappt',
      lines: [
        'Wir konnten die Verlängerung Ihres Abos nicht abbuchen. Ihr Schutz bleibt vorerst aktiv.',
        'Wir versuchen es am {nextAttemptAt, date, long} erneut. Bitte prüfen Sie bis dahin Ihre Zahlungsmethode.',
      ],
      action: 'Zahlungsmethode prüfen',
    },
    payment_failed_final: {
      subject: 'Ihr ParkShield-Schutz endet',
      lines: [
        'Auch der letzte Versuch, die Verlängerung abzubuchen, ist fehlgeschlagen. Ihr Abo endet, und Ihre Aufkleber werden inaktiv.',
        'Sie können jederzeit in Ihrem Konto ein neues Abo abschließen.',
      ],
      action: 'Zum Konto',
    },
    order_received: {
      subject: 'Ihr Aufkleber ist in Produktion',
      lines: [
        'Wir drucken Ihren ParkShield-Aufkleber für „{nickname}“. Der Versand dauert meist 3 bis 5 Werktage.',
        'Bis er ankommt, können Sie das PDF zum Selbstausdrucken nutzen.',
      ],
      action: 'PDF herunterladen',
    },
    alert_received: {
      subject: '{type}: „{nickname}“',
      lines: [
        'Jemand hat gerade Ihren ParkShield-Aufkleber an „{nickname}“ gescannt: {type}.',
        '{hasMessage, select, yes {Nachricht: „{message}“} other {}}',
        'Die Person sieht, dass Ihre Warnung angekommen ist. Antworten Sie mit einem Tipp, dann sieht sie auch Ihre Antwort:',
      ],
      action: 'Zum Konto',
    },
    alert_test: {
      subject: 'Test erfolgreich: „{nickname}“',
      lines: [
        'Ihr Aufkleber an „{nickname}“ funktioniert. So kommen Warnungen bei Ihnen an.',
        'Tipp: Schalten Sie zusätzlich Push oder WhatsApp ein, damit Sie Warnungen sofort sehen.',
      ],
      action: 'Zum Konto',
    },
    decal_shipped: {
      subject: 'Ihr Aufkleber ist unterwegs',
      lines: [
        'Ihr ParkShield-Aufkleber für „{nickname}“ wurde versandt. Sendungsnummer: {trackingNumber}.',
        'Bringen Sie ihn nach der Ankunft an und testen Sie ihn einmal: erst dann ist Ihr Schutz vollständig.',
      ],
      action: 'Zum Fahrzeug',
    },
    push_removed: {
      subject: 'Push-Benachrichtigungen auf {device} ausgeschaltet',
      lines: [
        'Wir konnten Push-Benachrichtigungen an {device} nicht mehr zustellen und haben das Gerät deshalb entfernt.',
        'Warnungen erreichen Sie weiter per E-Mail. Öffnen Sie Ihr Konto auf dem Gerät, um Push wieder einzuschalten.',
      ],
      action: 'Push wieder einschalten',
    },
    alert_followup: {
      subject: 'Erinnerung: Jemand wartet an „{nickname}“',
      lines: [
        'Die Person, die Sie wegen „{nickname}“ gewarnt hat ({type}), wartet noch auf Sie.',
        'Bitte kommen Sie zum Fahrzeug oder antworten Sie kurz, damit sie Bescheid weiß:',
      ],
    },
    escalation: {
      subject: 'ParkShield: {type} bei „{nickname}“',
      lines: [
        'Hallo {contact},',
        '{hasOwner, select, yes {{owner} hat Sie als Notfallkontakt eingetragen.} other {Sie sind als Notfallkontakt eingetragen.}} Gerade wurde gemeldet: {type} beim Fahrzeug „{nickname}“. Der Fahrer hat nicht reagiert oder ist nicht in der Nähe.',
        'Bitte versuchen Sie, ihn zu erreichen. Mehr wissen wir nicht, und mehr geben wir zum Schutz aller Beteiligten nicht weiter.',
        'Sie erhalten diese Nachricht, weil Sie zugestimmt haben. Über den Link in Ihrer Einladung können Sie sich jederzeit abmelden.',
      ],
    },
    ec_invite: {
      subject: '{owner} möchte Sie als Notfallkontakt bei ParkShield',
      lines: [
        'Hallo {contact},',
        '{owner} nutzt ParkShield: Wer ein Problem mit dem geparkten Auto bemerkt, kann den Fahrer anonym benachrichtigen. Reagiert der Fahrer bei einem dringenden Problem nicht, möchte {owner} Sie per E-Mail informieren.',
        'Sie erfahren dann nur, was los ist und um welches Fahrzeug es geht. Ohne Ihre Zustimmung schicken wir Ihnen nichts; ohne Antwort löschen wir Ihre Adresse nach 14 Tagen.',
      ],
      action: 'Einladung ansehen',
    },
    ec_decided: {
      subject:
        '{decision, select, confirmed {{contact} ist jetzt Ihr Notfallkontakt} declined {{contact} hat die Einladung abgelehnt} other {{contact} ist nicht mehr Ihr Notfallkontakt}}',
      lines: [
        '{decision, select, confirmed {{contact} hat zugestimmt. Bei dringenden Warnungen, auf die Sie nicht reagieren, informieren wir {contact} per E-Mail.} declined {{contact} möchte nicht Ihr Notfallkontakt sein. Sie können eine andere Person einladen.} other {{contact} hat die Zustimmung zurückgezogen. Laden Sie bei Bedarf eine andere Person ein.}}',
      ],
      action: 'Notfallkontakte verwalten',
    },
    activation_reminder: {
      subject: 'Ist Ihr Aufkleber an „{nickname}“ schon getestet?',
      lines: [
        'Ihr ParkShield-Aufkleber ist angekommen, aber noch nicht getestet. Erst nach dem Test wissen Sie sicher, dass Warnungen Sie erreichen.',
        'So geht es: Aufkleber anbringen, im Konto „Aufkleber testen“ tippen und den Code mit dem Handy scannen. Das dauert eine Minute.',
      ],
      action: 'Aufkleber jetzt testen',
    },
    decal_health: {
      subject: 'Funktioniert Ihr Aufkleber an „{nickname}“ noch?',
      lines: [
        'Ihr Aufkleber wurde seit {months} Monaten weder gescannt noch getestet. Sonne und Waschanlage können ihn ausbleichen.',
        'Ein kurzer Testscan zeigt, ob er noch gut lesbar ist. Falls nicht, bestellen Sie einfach einen Ersatz.',
      ],
      action: 'Aufkleber testen',
    },
    summary: {
      subject: 'Ihre ParkShield-Übersicht',
      lines: [
        'Seit {since, date, long}: {alerts, plural, =0 {keine Warnung} one {# Warnung} other {# Warnungen}} zu Ihren Fahrzeugen.',
        '{vehicles, plural, =0 {Noch kein Fahrzeug} one {# Fahrzeug} other {# Fahrzeuge}}, davon {active, plural, =0 {keines} one {# mit aktivem Aufkleber} other {# mit aktivem Aufkleber}}. Ihr Schutz: {score} %.',
        'Diese Übersicht ist ein Service zu Ihrem Abo. Wie oft sie kommt, stellen Sie im Konto ein.',
      ],
      action: 'Zum Konto',
    },
    fair_use_warning: {
      subject: '{channel}: {used} von {limit} Nachrichten in diesem Monat',
      lines: [
        'Sie haben diesen Monat bereits {used} von {limit} {channel}-Nachrichten Ihres Tarifs genutzt.',
        'Danach erreichen Warnungen Sie weiter per Push und E-Mail, ab dem 1. des nächsten Monats wieder per {channel}.',
      ],
      action: 'Benachrichtigungen ansehen',
    },
    fair_use_reached: {
      subject: '{channel}-Kontingent für diesen Monat aufgebraucht',
      lines: [
        'Die {limit} {channel}-Nachrichten Ihres Tarifs für diesen Monat sind aufgebraucht.',
        'Warnungen erreichen Sie bis zum Monatsende per Push und E-Mail. Schalten Sie Push ein, falls noch nicht geschehen.',
      ],
      action: 'Push einschalten',
    },
    deletion_requested: {
      subject: 'Ihr ParkShield-Konto wird gelöscht',
      lines: [
        'Wir löschen Ihr Konto und alle Daten am {due, date, long} um {due, time, short} Uhr. Ihre Aufkleber funktionieren ab sofort nicht mehr.',
        'Bis dahin können Sie die Löschung mit dem Link unten abbrechen. Die Aufkleber-Codes bleiben gesperrt; neue stellen Sie im Konto aus.',
        'Rechnungen bewahrt unser Zahlungsdienstleister Stripe auf, weil das Gesetz es verlangt (8 Jahre).',
      ],
      action: 'Löschung abbrechen',
    },
    account_deleted: {
      subject: 'Ihr ParkShield-Konto ist gelöscht',
      lines: [
        'Wir haben Ihr Konto und Ihre Daten gelöscht. Aus unseren verschlüsselten Sicherungen verschwinden sie spätestens nach 35 Tagen.',
        'Danke, dass Sie ParkShield genutzt haben.',
      ],
    },
    staff_invite: {
      subject: 'Ihr Zugang zu ParkShield Ops',
      lines: [
        'Hallo {name},',
        'für Sie wurde ein Zugang zur ParkShield-Ops-App angelegt. Richten Sie innerhalb von 72 Stunden einen Passkey ein. Der Link funktioniert nur im VPN.',
        'Passwörter gibt es nicht. Wenn Sie diesen Zugang nicht erwartet haben, melden Sie sich bitte sofort beim Security-Team.',
      ],
      action: 'Passkey einrichten',
    },
    break_glass_notice: {
      subject: 'Unser Support hat Ihre Daten eingesehen',
      lines: [
        'Am {when, date, long} um {when, time, short} Uhr hat eine Mitarbeiterin oder ein Mitarbeiter unseres Supports folgendes Feld eingesehen: {field}.',
        'Das geht bei uns nur mit Begründung, nach Freigabe durch eine zweite Person und für 15 Minuten. Vorgang: {ticket}.',
        'Wenn Sie dazu Fragen haben, antworten Sie einfach auf diese E-Mail.',
      ],
    },
    dsr_verify: {
      subject: 'Bitte bestätigen Sie Ihre Datenschutz-Anfrage',
      lines: [
        'Wir haben eine Datenschutz-Anfrage für diese E-Mail-Adresse erhalten (z. B. Auskunft oder Löschung).',
        'Damit niemand anderes in Ihrem Namen handelt, bestätigen Sie bitte, dass die Anfrage von Ihnen kommt. Ohne Bestätigung tun wir nichts.',
      ],
      action: 'Anfrage bestätigen',
    },
    dsr_export_ready: {
      subject: 'Ihre Daten stehen bereit',
      lines: [
        'Danke für die Bestätigung. Melden Sie sich an und laden Sie Ihre Daten als JSON und PDF herunter.',
      ],
      action: 'Daten herunterladen',
    },
    dsr_due_soon: {
      subject:
        '{count, plural, one {Eine Datenschutz-Anfrage} other {# Datenschutz-Anfragen}}: Frist in 7 Tagen',
      lines: [
        '{count, plural, one {Eine Anfrage muss} other {# Anfragen müssen}} bis spätestens {first, date, long} erledigt sein.',
      ],
      action: 'Warteschlange öffnen',
    },
    code_revoked_by_us: {
      subject: 'Wir haben den Code an „{nickname}“ gesperrt',
      lines: [
        'Wir haben an Ihrem Aufkleber für „{nickname}“ auffällig viele Warnungen oder Meldungen gesehen und den Code zu Ihrem Schutz gesperrt. Er hat jetzt einen neuen Code.',
        'Der Ersatzaufkleber ist für Sie kostenlos. Bestellen Sie ihn im Konto; bis er da ist, können Sie ihn als PDF ausdrucken.',
      ],
      action: 'Ersatzaufkleber bestellen',
    },
    decal_returned: {
      subject: 'Ihr Aufkleber für „{nickname}“ kam zurück',
      lines: [
        'Die Sendung mit Ihrem Aufkleber für „{nickname}“ wurde nicht zugestellt und kam zu uns zurück.',
        'Bitte schreiben Sie uns kurz, an welche Adresse wir ihn noch einmal schicken sollen. Der neue Versand ist für Sie kostenlos. Bis dahin können Sie den Aufkleber im Konto als PDF ausdrucken.',
      ],
      action: 'Support kontaktieren',
    },
    refund_issued: {
      subject: 'Wir haben Ihnen {amount} erstattet',
      lines: [
        'Wir haben Ihnen {amount} erstattet (Gutschrift {creditNote}). Das Geld ist meist nach 5 bis 10 Werktagen auf Ihrem Konto.',
        '{ended, select, yes {Ihr Abo ist damit beendet, Ihre Aufkleber sind ab sofort inaktiv.} other {An Ihrem Abo ändert sich dadurch nichts.}} Die Gutschrift finden Sie in Ihrem Konto.',
      ],
      action: 'Zum Konto',
    },
    provider_health_alert: {
      subject: 'Anbieter-Status: {count, plural, one {eine Änderung} other {# Änderungen}}',
      lines: ['{list}', 'Details und Kill Switches stehen in der Ops-App unter „Anbieter“.'],
      action: 'Anbieter-Status öffnen',
    },
    staff_expired: {
      subject:
        '{count, plural, one {Ein Ops-Zugang wurde} other {# Ops-Zugänge wurden}} wegen Inaktivität entzogen',
      lines: [
        'Seit {days} Tagen ohne Anmeldung, die Rollen sind entfernt: {list}.',
        'Wer den Zugang wieder braucht, bekommt die Rollen in der Ops-App unter „Mitarbeitende“ neu.',
      ],
      action: 'Zugriffsprüfung öffnen',
    },
    staff_review_due: {
      subject: 'Zugriffsprüfung der Ops-App ist fällig',
      lines: [
        'Alle {days} Tage prüfen wir, wer welche Rolle in der Ops-App hat. Die Prüfung ist jetzt fällig.',
        'Bitte bestätigen oder entziehen Sie jeden Zugang; die Prüfung wird im Audit-Log festgehalten.',
      ],
      action: 'Zugriffsprüfung öffnen',
    },
  },
  en: {
    magic_link: {
      subject: 'Your ParkShield sign-in link',
      lines: [
        'Hello,',
        'use this link to sign in to ParkShield. It is valid for 15 minutes and works only once.',
        'If you did not request a link, you can ignore this e-mail.',
      ],
      action: 'Sign in now',
    },
    new_device: {
      subject: 'New sign-in to ParkShield',
      lines: [
        'Your account was used on a new device on {when, date, long} at {when, time, short}: {device}.',
        'Not you? Sign in and remove unknown devices, or reply to this e-mail.',
      ],
    },
    subscription_started: {
      subject: 'Welcome to ParkShield {plan}',
      lines: [
        'Thank you! Your {plan} subscription is active until {periodEnd, date, long}.',
        'Your contract number: {contractNo}. You need it to cancel without signing in.',
        'You asked for the service to start immediately. If you withdraw within 14 days, you pay for the service provided until then.',
        'Your invoice is available in your account.',
      ],
      action: 'Open my account',
    },
    cancel_received: {
      subject: 'We have received your cancellation',
      lines: [
        'We received your cancellation on {receivedAt, date, long} at {receivedAt, time, short}.',
        'Contract number: {contractNo}. Your subscription ends on {endsAt, date, long}. Your protection stays active until then.',
        'There is nothing else you need to do.',
      ],
    },
    cancel_not_found: {
      subject: 'Your ParkShield cancellation',
      lines: [
        'We received a cancellation for this e-mail address on {receivedAt, date, long} at {receivedAt, time, short}.',
        'We could not find an active contract with the contract number you entered. Please check the number in your welcome e-mail or reply to this e-mail.',
      ],
    },
    waitlist_confirm: {
      subject: 'Please confirm your ParkShield Business waitlist sign-up',
      lines: [
        'You added {company} to the ParkShield Business waitlist.',
        'Please confirm. Without confirmation we delete the details after 30 days.',
      ],
      action: 'Confirm sign-up',
    },
    payment_failed: {
      subject: 'Your ParkShield payment did not go through',
      lines: [
        'We could not collect the renewal of your subscription. Your protection stays active for now.',
        'We will try again on {nextAttemptAt, date, long}. Please check your payment method before then.',
      ],
      action: 'Check payment method',
    },
    payment_failed_final: {
      subject: 'Your ParkShield protection is ending',
      lines: [
        'The last attempt to collect your renewal also failed. Your subscription ends and your decals become inactive.',
        'You can start a new subscription in your account at any time.',
      ],
      action: 'Open my account',
    },
    order_received: {
      subject: 'Your decal is being printed',
      lines: [
        'We are printing your ParkShield decal for “{nickname}”. Delivery usually takes 3 to 5 working days.',
        'Until it arrives, you can use the print-at-home PDF.',
      ],
      action: 'Download PDF',
    },
    alert_received: {
      subject: '{type}: “{nickname}”',
      lines: [
        'Someone just scanned your ParkShield decal on “{nickname}”: {type}.',
        '{hasMessage, select, yes {Message: “{message}”} other {}}',
        'They can see that your alert has arrived. Reply with one tap and they see your answer too:',
      ],
      action: 'Open my account',
    },
    alert_test: {
      subject: 'Test successful: “{nickname}”',
      lines: [
        'Your decal on “{nickname}” works. This is how alerts reach you.',
        'Tip: also turn on Push or WhatsApp so you see alerts immediately.',
      ],
      action: 'Open my account',
    },
    decal_shipped: {
      subject: 'Your decal is on its way',
      lines: [
        'Your ParkShield decal for “{nickname}” has been shipped. Tracking number: {trackingNumber}.',
        'Once it arrives, apply it and test it once: only then is your protection complete.',
      ],
      action: 'Open vehicle',
    },
    push_removed: {
      subject: 'Push notifications turned off on {device}',
      lines: [
        'We could no longer deliver push notifications to {device}, so we removed the device.',
        'Alerts still reach you by e-mail. Open your account on that device to turn push back on.',
      ],
      action: 'Turn push back on',
    },
    alert_followup: {
      subject: 'Reminder: someone is waiting at “{nickname}”',
      lines: [
        'The person who alerted you about “{nickname}” ({type}) is still waiting for you.',
        'Please go to your vehicle or send a short reply so they know:',
      ],
    },
    escalation: {
      subject: 'ParkShield: {type} at “{nickname}”',
      lines: [
        'Hello {contact},',
        '{hasOwner, select, yes {{owner} added you as an emergency contact.} other {You are listed as an emergency contact.}} Someone just reported: {type} at the vehicle “{nickname}”. The driver has not responded or is not nearby.',
        'Please try to reach them. We know nothing more, and to protect everyone involved we share nothing more.',
        'You receive this because you agreed to it. You can opt out at any time with the link in your invitation.',
      ],
    },
    ec_invite: {
      subject: '{owner} would like you as an emergency contact on ParkShield',
      lines: [
        'Hello {contact},',
        '{owner} uses ParkShield: anyone who notices a problem with the parked car can notify the driver anonymously. If the driver does not respond to an urgent problem, {owner} would like us to tell you by e-mail.',
        'You would only learn what is wrong and which vehicle it is. Without your consent we send you nothing; without an answer we delete your address after 14 days.',
      ],
      action: 'View invitation',
    },
    ec_decided: {
      subject:
        '{decision, select, confirmed {{contact} is now your emergency contact} declined {{contact} declined your invitation} other {{contact} is no longer your emergency contact}}',
      lines: [
        '{decision, select, confirmed {{contact} agreed. If you do not respond to an urgent alert, we tell {contact} by e-mail.} declined {{contact} does not want to be your emergency contact. You can invite someone else.} other {{contact} withdrew their consent. Invite someone else if needed.}}',
      ],
      action: 'Manage emergency contacts',
    },
    activation_reminder: {
      subject: 'Have you tested your decal on “{nickname}” yet?',
      lines: [
        'Your ParkShield decal has arrived but has not been tested yet. Only after the test do you know for sure that alerts reach you.',
        'How: apply the decal, tap “Test decal” in your account and scan the code with your phone. It takes a minute.',
      ],
      action: 'Test the decal now',
    },
    decal_health: {
      subject: 'Is your decal on “{nickname}” still working?',
      lines: [
        'Your decal has not been scanned or tested for {months} months. Sun and car washes can fade it.',
        'A quick test scan shows whether it is still easy to read. If not, simply order a replacement.',
      ],
      action: 'Test the decal',
    },
    summary: {
      subject: 'Your ParkShield summary',
      lines: [
        'Since {since, date, long}: {alerts, plural, =0 {no alerts} one {# alert} other {# alerts}} about your vehicles.',
        '{vehicles, plural, =0 {No vehicle yet} one {# vehicle} other {# vehicles}}, {active, plural, =0 {none} one {# with an active decal} other {# with an active decal}}. Your protection: {score} %.',
        'This summary is a service of your subscription. Choose how often it comes in your account.',
      ],
      action: 'Open my account',
    },
    fair_use_warning: {
      subject: '{channel}: {used} of {limit} messages this month',
      lines: [
        'You have already used {used} of the {limit} {channel} messages in your plan this month.',
        'After that, alerts still reach you by push and e-mail, and by {channel} again from the 1st of next month.',
      ],
      action: 'View notifications',
    },
    fair_use_reached: {
      subject: '{channel} allowance used up for this month',
      lines: [
        'The {limit} {channel} messages in your plan for this month are used up.',
        'Until the end of the month, alerts reach you by push and e-mail. Turn on push if you have not yet.',
      ],
      action: 'Turn on push',
    },
    deletion_requested: {
      subject: 'Your ParkShield account will be deleted',
      lines: [
        'We will delete your account and all data on {due, date, long} at {due, time, short}. Your decals stop working now.',
        'Until then you can cancel the deletion with the link below. The decal codes stay revoked; you can issue new ones in your account.',
        'Invoices are kept by our payment provider Stripe because the law requires it (8 years).',
      ],
      action: 'Cancel deletion',
    },
    account_deleted: {
      subject: 'Your ParkShield account has been deleted',
      lines: [
        'We have deleted your account and your data. They disappear from our encrypted backups within 35 days at the latest.',
        'Thank you for using ParkShield.',
      ],
    },
    staff_invite: {
      subject: 'Your access to ParkShield Ops',
      lines: [
        'Hello {name},',
        'an account for the ParkShield ops app has been created for you. Set up a passkey within 72 hours. The link only works on the VPN.',
        'There are no passwords. If you did not expect this access, please tell the security team at once.',
      ],
      action: 'Set up passkey',
    },
    break_glass_notice: {
      subject: 'Our support team viewed your data',
      lines: [
        'On {when, date, long} at {when, time, short}, a member of our support team viewed this field: {field}.',
        'This is only possible with a stated reason, after approval by a second person, and for 15 minutes. Case: {ticket}.',
        'If you have questions about it, simply reply to this e-mail.',
      ],
    },
    dsr_verify: {
      subject: 'Please confirm your privacy request',
      lines: [
        'We received a privacy request for this e-mail address (for example access or erasure).',
        'So that nobody else can act in your name, please confirm that the request comes from you. Without confirmation we do nothing.',
      ],
      action: 'Confirm request',
    },
    dsr_export_ready: {
      subject: 'Your data is ready',
      lines: ['Thank you for confirming. Sign in and download your data as JSON and PDF.'],
      action: 'Download data',
    },
    dsr_due_soon: {
      subject:
        '{count, plural, one {One privacy request} other {# privacy requests}}: deadline in 7 days',
      lines: [
        '{count, plural, one {One request has} other {# requests have}} to be completed by {first, date, long} at the latest.',
      ],
      action: 'Open the queue',
    },
    code_revoked_by_us: {
      subject: 'We revoked the code on “{nickname}”',
      lines: [
        'We saw unusually many alerts or reports on your decal for “{nickname}” and revoked the code to protect you. It now has a new code.',
        'The replacement decal is free for you. Order it in your account; until it arrives you can print it as a PDF.',
      ],
      action: 'Order replacement decal',
    },
    decal_returned: {
      subject: 'Your decal for “{nickname}” came back',
      lines: [
        'The parcel with your decal for “{nickname}” could not be delivered and came back to us.',
        'Please tell us briefly where we should send it again. The new shipment is free for you. Until then you can print the decal as a PDF in your account.',
      ],
      action: 'Contact support',
    },
    refund_issued: {
      subject: 'We refunded {amount}',
      lines: [
        'We refunded {amount} to you (credit note {creditNote}). The money usually arrives within 5 to 10 working days.',
        '{ended, select, yes {Your subscription has ended, your decals are inactive from now on.} other {Your subscription stays as it is.}} You will find the credit note in your account.',
      ],
      action: 'Go to account',
    },
    provider_health_alert: {
      subject: 'Provider status: {count, plural, one {one change} other {# changes}}',
      lines: ['{list}', 'Details and kill switches are in the ops app under “Providers”.'],
      action: 'Open provider status',
    },
    staff_expired: {
      subject:
        '{count, plural, one {One ops account} other {# ops accounts}} lost access after inactivity',
      lines: [
        'No sign-in for {days} days, the roles were removed: {list}.',
        'Anyone who needs access again gets the roles back in the ops app under “Staff”.',
      ],
      action: 'Open the access review',
    },
    staff_review_due: {
      subject: 'The ops access review is due',
      lines: [
        'Every {days} days we check who has which role in the ops app. The review is due now.',
        'Please confirm or remove each account; the review is recorded in the audit log.',
      ],
      action: 'Open the access review',
    },
  },
} satisfies Record<MailLocale, Record<string, TemplateSource>>;

export type MailTemplate = keyof (typeof templates)['de'];
export type MailValues = Record<string, string | number | Date>;
export { templates as mailTemplates };

const TZ = 'Europe/Berlin';
const BERLIN_FORMATS = {
  date: { long: { year: 'numeric', month: 'long', day: 'numeric', timeZone: TZ } },
  time: { short: { hour: 'numeric', minute: '2-digit', timeZone: TZ } },
} as const;

const escapeHtml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );

export function renderMail(
  template: MailTemplate,
  locale: MailLocale,
  values: MailValues,
  actionUrl?: string,
  /** Quick replies (NT-02): rendered as buttons above the main action, each a link to the reply page. */
  replies: { label: string; url: string }[] = [],
): { subject: string; text: string; html: string } {
  const src: TemplateSource = templates[locale][template];
  const fmt = (s: string) =>
    String(new IntlMessageFormat(s, locale, BERLIN_FORMATS).format(values));
  const subject = fmt(src.subject);
  const lines = src.lines.map(fmt).filter((l) => l.trim() !== ''); // optional lines render empty
  const action = src.action && actionUrl ? { label: fmt(src.action), url: actionUrl } : undefined;
  const button = (a: { label: string; url: string }, primary: boolean) =>
    `<a href="${escapeHtml(a.url)}" style="display:inline-block;margin:0 8px 8px 0;${primary ? 'background:#1d4ed8;color:#fff' : 'background:#e2e8f0;color:#0f172a'};padding:12px 20px;border-radius:12px;text-decoration:none;font-weight:600">${escapeHtml(a.label)}</a>`;

  const text = [
    ...lines,
    ...replies.map((r) => `${r.label}: ${r.url}`),
    ...(action ? ['', `${action.label}: ${action.url}`] : []),
    '',
    '— ParkShield',
  ].join('\n\n');
  const html = `<!doctype html><html lang="${locale}"><body style="font-family:system-ui,Segoe UI,Arial,sans-serif;font-size:16px;line-height:1.5;color:#0f172a">
${lines.map((l) => `<p>${escapeHtml(l)}</p>`).join('\n')}
${replies.length ? `<p>${replies.map((r, i) => button(r, i === 0)).join('')}</p>` : ''}
${action ? `<p>${button(action, replies.length === 0)}</p>` : ''}
<p style="color:#475569">— ParkShield</p></body></html>`;
  return { subject, text, html };
}
