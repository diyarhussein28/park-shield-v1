import { IntlMessageFormat } from 'intl-messageformat';
import { DEFAULT_FRAME, renderLayout, type MailFrame } from './layout';

export type MailLocale = 'de' | 'en';

interface TemplateSource {
  subject: string;
  /** The body headline; default: a greeting in the first line („Hallo,“), else the subject. */
  headline?: string;
  lines: string[];
  /** A highlighted box (e.g. the sign-in code) with an optional note under it. */
  highlight?: { value: string; note?: string };
  action?: string;
  /** Small grey text under the button. */
  footnote?: string;
}

const templates = {
  de: {
    sign_in_code: {
      subject: 'Ihr ParkShield-Anmeldecode: {code}',
      headline: 'Hallo,',
      lines: ['Ihr ParkShield-Anmeldecode lautet:'],
      highlight: { value: '{code}', note: 'Gültig für 15 Minuten' },
      action: 'In der App anmelden',
      footnote:
        'Geben Sie den Code in der ParkShield-App ein oder tippen Sie auf „In der App anmelden“. Code und Link funktionieren nur einmal. Wenn Sie nichts angefordert haben, können Sie diese E-Mail ignorieren.',
    },
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
        'Waren Sie das nicht? Melden Sie sich an und entfernen Sie unbekannte Geräte, oder schreiben Sie uns über „Hilfe & Kontakt“.',
      ],
    },
    // § 312f BGB: contract confirmation on a durable medium; the full terms, the withdrawal policy,
    // the model withdrawal form and the declaration are in the attached PDF „Vertragsbestätigung“.
    // TODO [LEGAL REVIEW]
    contract_confirmation: {
      subject: 'Ihre Vertragsbestätigung für ParkShield ({contractNo})',
      headline: 'Vielen Dank! Ihr Vertrag ist abgeschlossen.',
      lines: [
        'Tarif: ParkShield – ein Fahrzeug, alles inklusive. Preis: {price} pro Jahr inkl. 19 % MwSt.',
        'Vertragsnummer: {contractNo}\nKundennummer: {customerNo}\nVertragsbeginn: {startedAt, date, long}\nNächste Verlängerung: {periodEnd, date, long}',
        'Laufzeit und Verlängerung: {renewalRule}',
        'Ihre Erklärung vom {consentAt, date, long} um {consentAt, time, short} Uhr: „{consentText}“',
        'Im Anhang finden Sie Ihre Vertragsbestätigung als PDF mit den bei Vertragsschluss gültigen AGB, der Widerrufsbelehrung und dem Muster-Widerrufsformular (Fassung {docVersion}).',
        'Kündigen können Sie jederzeit über „Verträge hier kündigen“ unten auf jeder Seite, widerrufen innerhalb der Widerrufsfrist über „Vertrag widerrufen“.',
      ],
      action: 'Zum Konto',
    },
    // § 312k BGB. TODO [LEGAL REVIEW]
    cancel_received: {
      subject: 'Bestätigung Ihrer Kündigung ({contractNo})',
      lines: [
        'Wir haben Ihre Kündigung am {receivedAt, date, long} um {receivedAt, time, short} Uhr erhalten.',
        'Inhalt Ihrer Kündigung: {kind, select, extraordinary {außerordentliche Kündigung} other {ordentliche Kündigung}} des Vertrags {contractNo}.',
        '{requestedLine}',
        '{reasonLine}',
        'Ihr Vertrag endet am {endsAt, date, long}. Bis dahin bleibt Ihr Schutz voll aktiv; danach werden keine Beträge mehr abgebucht.',
        'Sie haben nicht gekündigt oder möchten es sich anders überlegen? Mit dem Link unten nehmen Sie die Kündigung bis zum Vertragsende mit einem Klick zurück.',
      ],
      action: 'Kündigung zurücknehmen',
    },
    cancel_needs_review: {
      subject: 'Ihre Kündigung bei ParkShield ist eingegangen',
      lines: [
        'Wir haben Ihre Kündigung am {receivedAt, date, long} um {receivedAt, time, short} Uhr erhalten.',
        'Wir konnten sie noch keinem Vertrag zuordnen und prüfen sie jetzt von Hand. Sobald wir den Vertrag gefunden haben, bestätigen wir Ihnen das Vertragsende. Die Kündigung gilt als zu dem Zeitpunkt zugegangen, zu dem wir sie erhalten haben.',
      ],
    },
    cancel_revoked: {
      subject: 'Ihre Kündigung wurde zurückgenommen',
      lines: [
        'Sie haben Ihre Kündigung des Vertrags {contractNo} zurückgenommen. Ihr Vertrag läuft unverändert weiter.',
        'Wenn Sie das nicht waren, können Sie jederzeit erneut über „Verträge hier kündigen“ kündigen.',
      ],
      action: 'Zum Konto',
    },
    // § 356a BGB: receipt only, it does not confirm that the withdrawal is valid. TODO [LEGAL REVIEW]
    withdrawal_received: {
      subject: 'Eingangsbestätigung Ihres Widerrufs',
      lines: [
        'Wir haben Ihren Widerruf am {receivedAt, date, long} um {receivedAt, time, short} Uhr erhalten.',
        'Inhalt Ihres Widerrufs: Name: {name} · Vertrag: {contractRef} · E-Mail für diese Bestätigung: {receiptEmail}.',
        'Wir bearbeiten Ihren Widerruf und informieren Sie über die Erstattung.',
      ],
    },
    // TODO [LEGAL REVIEW]
    renewal_reminder: {
      subject: 'Ihr ParkShield-Vertrag verlängert sich am {renewsAt, date, long}',
      lines: [
        'Ihr Vertrag {contractNo} verlängert sich am {renewsAt, date, long}, wenn Sie nicht vorher kündigen.',
        'Danach kostet er {price} {interval, select, month {pro Monat} other {pro Jahr}}, inklusive 19 % Umsatzsteuer.',
        '{renewalRule}',
        'Kündigen können Sie jederzeit ohne Anmeldung über den Link unten.',
      ],
      action: 'Verträge hier kündigen',
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
        'Jemand hat am {at, date, long} um {at, time, short} Uhr Ihren ParkShield-Aufkleber an „{nickname}“ gescannt: {type}.',
        '{hasMessage, select, yes {Nachricht: „{message}“} hidden {Nachricht von nicht bestätigtem Absender – ansehen in ParkShield} other {}}',
        'Die Person sieht, dass Ihre Warnung angekommen ist. Tippen Sie auf „Ich komme“, dann sieht sie Ihre Antwort:',
      ],
      action: 'Details & Fotos ansehen',
    },
    // Phase 2: alert with photos. Only the link to the view page, never an attachment or embedded image.
    alert_received_photos: {
      subject: '{type}: „{nickname}“ (mit Fotos)',
      lines: [
        'Jemand hat am {at, date, long} um {at, time, short} Uhr Ihren ParkShield-Aufkleber an „{nickname}“ gescannt: {type}. Die Person hat Fotos angehängt.',
        '{hasMessage, select, yes {Nachricht: „{message}“} hidden {Nachricht von nicht bestätigtem Absender – ansehen in ParkShield} other {}}',
        'Die Fotos sehen Sie nur in der App oder über den Link unten, nie als Anhang. Tippen Sie auf „Ich komme“, dann sieht die Person Ihre Antwort:',
      ],
      action: 'Details & Fotos ansehen',
    },
    alert_reminder: {
      subject: 'Erinnerung: {type} bei „{nickname}“',
      lines: [
        'Sie haben auf die Warnung von {at, time, short} Uhr noch nicht reagiert: {type} bei „{nickname}“.',
        '{noApp, select, yes {Hinweis: Sie haben keine App mit aktivierten Mitteilungen. Ohne Mitteilungen erfahren Sie nicht sofort von Problemen an Ihrem Fahrzeug. Installieren Sie die ParkShield-App und erlauben Sie Mitteilungen.} other {}}',
        'Tippen Sie auf „Ich komme“, wenn Sie sich darum kümmern:',
      ],
      action: 'Details & Fotos ansehen',
    },
    alert_test: {
      subject: 'Test erfolgreich: „{nickname}“',
      lines: [
        'Ihr Aufkleber an „{nickname}“ funktioniert. So kommen Warnungen bei Ihnen an.',
        'Tipp: Installieren Sie die ParkShield-App und erlauben Sie Mitteilungen, damit Sie Warnungen sofort sehen.',
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
    // TODO [LEGAL REVIEW] Only the alert type and the vehicle label: no plate, no scanner text, no photo.
    escalation: {
      subject: 'ParkShield: {type} bei „{nickname}“',
      lines: [
        'Hallo {contact},',
        '{hasOwner, select, yes {{owner} hat Sie als Vertrauensperson hinterlegt.} other {Sie sind als Vertrauensperson hinterlegt.}} Gerade wurde gemeldet: {type} beim Fahrzeug „{nickname}“. Der Fahrer hat noch nicht reagiert.',
        'Können Sie sich darum kümmern? Dann tippen Sie auf „Ich komme“: Der Fahrer und die Person am Fahrzeug sehen, dass jemand unterwegs ist, und niemand weiteres wird benachrichtigt.',
        'Sie erhalten diese Nachricht, weil Sie zugestimmt haben.',
      ],
      action: 'Ich komme',
    },
    // TODO [LEGAL REVIEW] Consent text for emergency contacts (what they receive, 14-day deletion).
    ec_invite: {
      subject: '{owner} möchte Sie als Vertrauensperson bei ParkShield hinterlegen',
      lines: [
        'Hallo {contact},',
        '{owner} nutzt ParkShield: Wer ein Problem mit dem geparkten Auto bemerkt, kann den Fahrer anonym benachrichtigen. Reagiert der Fahrer bei einem dringenden Problem nicht, möchte {owner} Sie per SMS und E-Mail informieren.',
        'Sie erfahren dann nur, was los ist und welches Fahrzeug es ist (die Bezeichnung, die {owner} gewählt hat), kein Kennzeichen und keine Nachricht. Mit „Ich komme“ zeigen Sie, dass Sie sich kümmern; jede Nachricht enthält einen Link zum Abmelden.',
        'Ohne Ihre Zustimmung schicken wir Ihnen nichts. Ohne Antwort oder nach einer Ablehnung löschen wir Ihre Daten nach 14 Tagen.',
      ],
      action: 'Annehmen oder ablehnen',
    },
    ec_decided: {
      subject:
        '{decision, select, confirmed {{contact} ist jetzt Ihr Notfallkontakt} declined {{contact} hat die Einladung abgelehnt} other {{contact} ist nicht mehr Ihr Notfallkontakt}}',
      lines: [
        '{decision, select, confirmed {{contact} hat zugestimmt. Bei dringenden Warnungen, auf die Sie nicht reagieren, informieren wir {contact} per E-Mail.} declined {{contact} möchte nicht Ihr Notfallkontakt sein. Sie können eine andere Person einladen.} other {{contact} hat die Zustimmung zurückgezogen. Laden Sie bei Bedarf eine andere Person ein.}}',
      ],
      action: 'Notfallkontakte verwalten',
    },
    push_denied: {
      subject: 'Mitteilungen für ParkShield sind ausgeschaltet',
      lines: [
        'Sie haben der ParkShield-App auf {device} keine Mitteilungen erlaubt.',
        'Ohne Mitteilungen erfahren Sie nicht sofort von Problemen an Ihrem Fahrzeug. Warnungen kommen dann nur per E-Mail{sms, select, yes { und SMS} other {}}. Sie können Mitteilungen jederzeit in den Einstellungen Ihres Handys für ParkShield einschalten.',
      ],
    },
    ec_deactivated: {
      subject: 'Eskalation an Vertrauenspersonen pausiert',
      lines: [
        'Ihr Tarif ist nicht mehr Premium. Die Eskalation an Ihre Vertrauenspersonen ist deshalb ab sofort aus, und Ihre Vertrauenspersonen werden nicht mehr benachrichtigt.',
        'Wir bewahren die Kontakte 30 Tage lang deaktiviert auf, bis {until, date, long}. Wechseln Sie bis dahin wieder zu Premium, sind sie sofort wieder aktiv; danach löschen wir sie.',
      ],
      action: 'Tarif ansehen',
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
        'Wenn Sie dazu Fragen haben, schreiben Sie uns über „Hilfe & Kontakt“.',
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
    sign_in_code: {
      subject: 'Your ParkShield sign-in code: {code}',
      headline: 'Hello,',
      lines: ['Your ParkShield sign-in code is:'],
      highlight: { value: '{code}', note: 'Valid for 15 minutes' },
      action: 'Sign in in the app',
      footnote:
        'Enter the code in the ParkShield app or tap “Sign in in the app”. The code and the link work only once. If you did not request anything, you can ignore this e-mail.',
    },
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
        'Not you? Sign in and remove unknown devices, or write to us via “Help & Contact”.',
      ],
    },
    contract_confirmation: {
      subject: 'Your contract confirmation for ParkShield ({contractNo})',
      headline: 'Thank you! Your contract is concluded.',
      lines: [
        'Plan: ParkShield – one vehicle, everything included. Price: {price} per year incl. 19% VAT.',
        'Contract number: {contractNo}\nCustomer number: {customerNo}\nStart: {startedAt, date, long}\nNext renewal: {periodEnd, date, long}',
        'Term and renewal: {renewalRule}',
        'Your declaration of {consentAt, date, long} at {consentAt, time, short}: “{consentText}”',
        'Attached is your contract confirmation as a PDF with the terms, the withdrawal policy and the model withdrawal form as they applied when the contract was concluded (version {docVersion}). The German version is binding.',
        'You can cancel at any time via “Cancel contract” at the bottom of every page, and withdraw within the withdrawal period via “Withdraw from contract”.',
      ],
      action: 'Open my account',
    },
    cancel_received: {
      subject: 'Confirmation of your cancellation ({contractNo})',
      lines: [
        'We received your cancellation on {receivedAt, date, long} at {receivedAt, time, short}.',
        'Content of your cancellation: {kind, select, extraordinary {extraordinary cancellation} other {ordinary cancellation}} of contract {contractNo}.',
        '{requestedLine}',
        '{reasonLine}',
        'Your contract ends on {endsAt, date, long}. Your protection stays fully active until then; nothing is charged afterwards.',
        'You did not cancel, or changed your mind? The link below takes the cancellation back with one click until the end date.',
      ],
      action: 'Take back the cancellation',
    },
    cancel_needs_review: {
      subject: 'We have received your ParkShield cancellation',
      lines: [
        'We received your cancellation on {receivedAt, date, long} at {receivedAt, time, short}.',
        'We could not match it to a contract yet and are checking it by hand. Once we have found the contract we confirm the end date. The cancellation counts as received at the time we received it.',
      ],
    },
    cancel_revoked: {
      subject: 'Your cancellation was taken back',
      lines: [
        'You took back the cancellation of contract {contractNo}. Your contract continues unchanged.',
        'If this was not you, you can cancel again at any time via “Cancel contract here”.',
      ],
      action: 'Open my account',
    },
    withdrawal_received: {
      subject: 'Receipt of your withdrawal',
      lines: [
        'We received your withdrawal on {receivedAt, date, long} at {receivedAt, time, short}.',
        'Content of your withdrawal: name: {name} · contract: {contractRef} · e-mail for this receipt: {receiptEmail}.',
        'We are processing your withdrawal and will inform you about the refund.',
      ],
    },
    renewal_reminder: {
      subject: 'Your ParkShield contract renews on {renewsAt, date, long}',
      lines: [
        'Your contract {contractNo} renews on {renewsAt, date, long} unless you cancel before.',
        'It then costs {price} {interval, select, month {per month} other {per year}}, including 19% VAT.',
        '{renewalRule}',
        'You can cancel at any time without signing in via the link below.',
      ],
      action: 'Cancel contract here',
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
        'On {at, date, long} at {at, time, short} someone scanned your ParkShield decal on “{nickname}”: {type}.',
        '{hasMessage, select, yes {Message: “{message}”} hidden {Message from an unconfirmed sender – view it in ParkShield} other {}}',
        'They can see that your alert has arrived. Tap “I’m coming” and they see your answer:',
      ],
      action: 'View details & photos',
    },
    alert_received_photos: {
      subject: '{type}: “{nickname}” (with photos)',
      lines: [
        'On {at, date, long} at {at, time, short} someone scanned your ParkShield decal on “{nickname}”: {type}. They attached photos.',
        '{hasMessage, select, yes {Message: “{message}”} hidden {Message from an unconfirmed sender – view it in ParkShield} other {}}',
        'You see the photos only in the app or through the link below, never as an attachment. Tap “I’m coming” and they see your answer:',
      ],
      action: 'View details & photos',
    },
    alert_reminder: {
      subject: 'Reminder: {type} at “{nickname}”',
      lines: [
        'You have not responded to the alert from {at, time, short} yet: {type} at “{nickname}”.',
        '{noApp, select, yes {Note: you have no app with notifications turned on. Without notifications you do not learn about problems with your vehicle right away. Install the ParkShield app and allow notifications.} other {}}',
        'Tap “I’m coming” when you take care of it:',
      ],
      action: 'View details & photos',
    },
    alert_test: {
      subject: 'Test successful: “{nickname}”',
      lines: [
        'Your decal on “{nickname}” works. This is how alerts reach you.',
        'Tip: install the ParkShield app and allow notifications so you see alerts immediately.',
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
        '{hasOwner, select, yes {{owner} added you as a trusted contact.} other {You are listed as a trusted contact.}} Someone just reported: {type} at the vehicle “{nickname}”. The driver has not responded yet.',
        'Can you take care of it? Then tap “I’m coming”: the driver and the person at the vehicle see that someone is on the way, and nobody else is notified.',
        'You receive this because you agreed to it.',
      ],
      action: 'I’m coming',
    },
    ec_invite: {
      subject: '{owner} would like you as a trusted contact on ParkShield',
      lines: [
        'Hello {contact},',
        '{owner} uses ParkShield: anyone who notices a problem with the parked car can notify the driver anonymously. If the driver does not respond to an urgent problem, {owner} would like us to tell you by SMS and e-mail.',
        'You would only learn what is wrong and which vehicle it is (the label {owner} chose): no licence plate and no message. With “I’m coming” you show that you take care of it; every message has a link to opt out.',
        'Without your consent we send you nothing. Without an answer, or after you decline, we delete your details after 14 days.',
      ],
      action: 'Accept or decline',
    },
    ec_decided: {
      subject:
        '{decision, select, confirmed {{contact} is now your emergency contact} declined {{contact} declined your invitation} other {{contact} is no longer your emergency contact}}',
      lines: [
        '{decision, select, confirmed {{contact} agreed. If you do not respond to an urgent alert, we tell {contact} by e-mail.} declined {{contact} does not want to be your emergency contact. You can invite someone else.} other {{contact} withdrew their consent. Invite someone else if needed.}}',
      ],
      action: 'Manage emergency contacts',
    },
    push_denied: {
      subject: 'Notifications for ParkShield are turned off',
      lines: [
        'You have not allowed the ParkShield app on {device} to send notifications.',
        'Without notifications you do not learn about problems with your vehicle right away. Alerts then only arrive by e-mail{sms, select, yes { and SMS} other {}}. You can turn notifications on for ParkShield in your phone’s settings at any time.',
      ],
    },
    ec_deactivated: {
      subject: 'Escalation to trusted contacts paused',
      lines: [
        'Your plan is no longer Premium. Escalation to your trusted contacts is therefore off from now on, and they are no longer notified.',
        'We keep the contacts deactivated for 30 days, until {until, date, long}. If you switch back to Premium by then, they are active again at once; after that we delete them.',
      ],
      action: 'View plans',
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
        'If you have questions about it, write to us via “Help & Contact”.',
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

export function renderMail(
  template: MailTemplate,
  locale: MailLocale,
  values: MailValues,
  actionUrl?: string,
  /** Quick replies (NT-02): rendered as buttons above the main action, each a link to the reply page. */
  replies: { label: string; url: string }[] = [],
  /** Small text links below the main action (e.g. "Missbrauch melden"). */
  links: { label: string; url: string }[] = [],
  /** Website and company data for the shared layout (footer, logo, help and legal links). */
  frame: MailFrame = DEFAULT_FRAME,
): { subject: string; text: string; html: string } {
  const src: TemplateSource = templates[locale][template];
  const fmt = (s: string) =>
    String(new IntlMessageFormat(s, locale, BERLIN_FORMATS).format(values));
  const subject = fmt(src.subject);
  let lines = src.lines.map(fmt).filter((l) => l.trim() !== ''); // optional lines render empty
  let headline = src.headline ? fmt(src.headline) : undefined;
  // A greeting in the first line („Hallo Anna,“) becomes the headline, as in the design.
  if (!headline && lines[0] && /^(Hallo|Hello)\b[^.!?]{0,40},$/.test(lines[0])) {
    headline = lines[0];
    lines = lines.slice(1);
  }
  const action = src.action && actionUrl ? { label: fmt(src.action), url: actionUrl } : undefined;
  return {
    subject,
    ...renderLayout(
      {
        locale,
        subject,
        headline: headline ?? subject,
        lines,
        highlight: src.highlight
          ? {
              value: fmt(src.highlight.value),
              note: src.highlight.note ? fmt(src.highlight.note) : undefined,
            }
          : undefined,
        replies,
        action,
        footnote: src.footnote ? fmt(src.footnote) : undefined,
        links,
      },
      frame,
    ),
  };
}
