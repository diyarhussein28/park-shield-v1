import { getLocales } from 'expo-localization';

/** German is the source language, English the second (same rule as the website). */
const de = {
  error: 'Das hat nicht geklappt. Bitte versuchen Sie es noch einmal.',
  offline: 'Keine Verbindung. Wir versuchen es weiter …',
  back: 'Zurück',
  // sign-in
  signInTitle: 'Anmelden',
  signInIntro:
    'Melden Sie sich mit der E-Mail-Adresse Ihres ParkShield-Kontos an. Wir schicken Ihnen einen Anmeldelink.',
  email: 'E-Mail-Adresse',
  sendLink: 'Anmeldelink senden',
  linkSent: 'Wir haben Ihnen einen Link an {email} geschickt. Öffnen Sie ihn auf diesem Handy.',
  pasteLink: 'Link einfügen',
  pasteHint:
    'Öffnet sich der Link nicht in der App? Kopieren Sie ihn aus der E-Mail und fügen Sie ihn hier ein.',
  signInWithLink: 'Mit Link anmelden',
  linkInvalid: 'Dieser Link ist ungültig oder schon benutzt. Bitte fordern Sie einen neuen an.',
  // push permission
  pushTitle: 'Mitteilungen erlauben',
  pushWhy: 'Ohne Mitteilungen erfahren Sie nicht sofort von Problemen an Ihrem Fahrzeug.',
  pushWhat:
    'Eine Mitteilung enthält nur die Art der Warnung, etwa „Ausfahrt blockiert“. Alles Weitere laden wir sicher, wenn Sie die App öffnen. Mit „Ich komme“ direkt in der Mitteilung antworten Sie sofort.',
  pushAllow: 'Weiter zur Abfrage',
  pushLater: 'Später',
  pushDeniedBanner:
    'Mitteilungen sind ausgeschaltet. Ohne Mitteilungen erfahren Sie nicht sofort von Problemen an Ihrem Fahrzeug.',
  pushOpenSettings: 'Einstellungen öffnen',
  pushNoFirebase:
    'Diese Version der App kann keine Mitteilungen empfangen (Entwicklungsversion ohne Firebase).',
  // alerts
  alertsTitle: 'Warnungen',
  alertsEmpty: 'Noch keine Warnungen. Wenn jemand Ihren Aufkleber scannt, sehen Sie es hier.',
  seen: 'Gesehen',
  acknowledged: 'Erledigt',
  open: 'Offen',
  expired: 'Abgelaufen',
  escalated: 'Vertrauensperson benachrichtigt',
  test: 'Test',
  photos: '{count, plural, one {# Foto} other {# Fotos}}',
  // alert detail
  alertTitle: 'Warnung',
  at: '{time} Uhr',
  message: 'Nachricht',
  hiddenContent: 'Nachricht von nicht bestätigtem Absender',
  reveal: 'Anzeigen',
  coming: 'Ich komme',
  comingDone: 'Sie haben „Ich komme“ gesendet. Die Person am Fahrzeug sieht das.',
  comingByContact: '{name} kümmert sich darum.',
  comingByContactNoName: 'Eine Vertrauensperson kümmert sich darum.',
  in30: 'In ca. 30 Min',
  notNearby: 'Bin nicht in der Nähe',
  savePhoto: 'Speichern',
  photoSaved: 'Foto gespeichert.',
  photoAlt: 'Foto {n} zur Warnung',
  chatOpen: 'Rückfrage stellen / Chat öffnen',
  chatContinue: 'Zum Chat',
  chatBlocked: 'Ein Chat ist mit diesem Absender nicht möglich.',
  chatPurged: 'Chatverlauf wurde nach 24 Stunden automatisch gelöscht.',
  senderOnline: 'Absender ist gerade online',
  senderOffline: 'Absender ist nicht mehr online (zuletzt vor {minutes} Min.)',
  senderOfflineNever: 'Absender ist nicht online',
  escalationStep: 'Vertrauensperson {step} von 3 benachrichtigt: {name}',
  // chat
  chatTitle: 'Chat',
  chatClose: 'Erledigt / Chat schließen',
  chatClosed: 'Der Chat ist beendet.',
  chatPlaceholder: 'Nachricht …',
  chatSend: 'Senden',
  chatTyping: 'Absender schreibt …',
  chatRemaining: 'Noch {count} Nachrichten',
  chatPersonalTitle: 'Persönliche Daten teilen?',
  chatPersonalText:
    'Möchten Sie wirklich persönliche Daten teilen? Ihre Nachricht enthält offenbar eine Telefonnummer, E-Mail-Adresse oder Adresse.',
  chatPersonalSend: 'Trotzdem senden',
  chatPersonalCancel: 'Abbrechen',
  chatYou: 'Sie',
  chatScanner: 'Absender',
  chatRead: 'Gelesen',
  // settings
  notifications: 'Mitteilungen',
  notificationsOn: 'Mitteilungen sind eingeschaltet.',
  escalationTitle: 'Eskalation an Vertrauenspersonen',
  escalationLocked: 'Verfügbar im Premium-Tarif',
  escalationText:
    'Reagieren Sie nicht, benachrichtigen wir nacheinander bis zu 3 Vertrauenspersonen per SMS und E-Mail.',
  escalationSuggest:
    'Eine Vertrauensperson hat zugestimmt. Möchten Sie die Eskalation jetzt einschalten?',
  escalationDelay: 'Wartezeit: {minutes} Minuten',
  escalationVehicle: 'Für dieses Fahrzeug',
  contacts: 'Vertrauenspersonen',
  contactsEmpty: 'Noch keine Vertrauenspersonen.',
  contactAdd: 'Vertrauensperson einladen',
  contactName: 'Vorname',
  contactPhone: 'Handynummer',
  contactEmail: 'E-Mail-Adresse (optional)',
  ownerName: 'Ihr Vorname (sieht die Person in der Einladung)',
  contactInvite: 'Einladung senden',
  contactRemove: 'Entfernen',
  contactUp: 'Nach oben',
  contactStatus_pending: 'Eingeladen',
  contactStatus_confirmed: 'Bestätigt',
  contactStatus_declined: 'Abgelehnt',
  contactStatus_deactivated: 'Deaktiviert (Tarif)',
  contactStatus_revoked: 'Zurückgezogen',
  help: 'Hilfe',
  helpText:
    'Fragen zu ParkShield beantwortet die Hilfe auf park-shield.de. Bei Problemen mit Mitteilungen prüfen Sie den Fokus-Modus und die Mitteilungen für ParkShield in den Einstellungen Ihres Handys.',
  helpOpen: 'Hilfe öffnen',
  vehiclesNone:
    'Noch keine Fahrzeuge. Legen Sie Ihr erstes Fahrzeug an, sein QR-Code wird sofort erstellt.',
  decalNone:
    'Für dieses Fahrzeug gibt es gerade keinen gültigen QR-Code. Einen neuen erhalten Sie im Kundenportal.',
  vehicleAddHint:
    'Spitzname und Kennzeichen genügen. Den Spitznamen sieht die Person am Fahrzeug, das Kennzeichen nie.',
  vehicleNeedsPlan:
    'Für ein Fahrzeug brauchen Sie ein Abo. Das schließen Sie im Kundenportal auf der Website ab.',
  vehicleInvalid:
    'Bitte prüfen Sie Spitzname und Kennzeichen (nur Buchstaben, Ziffern, Leerzeichen und Bindestrich).',
  decalSharePdfHint:
    'Zum Ausdrucken, Speichern in „Dateien“ oder Weiterschicken. Kostenlos und jederzeit.',
  decalShareFailed:
    'Die Druckvorlage konnte nicht geöffnet werden. Bitte versuchen Sie es noch einmal.',
  decalTestText:
    'Scannen Sie Ihren Aufkleber nach dem Anbringen einmal selbst. Während des Tests geht die Warnung nur an Sie.',
  decalTestOpen:
    'Der Test läuft bis {time} Uhr. Scannen Sie jetzt den Aufkleber mit der Handykamera.',
  vehiclePortalHint:
    'Design, Ersatz-Aufkleber, gedruckten Aufkleber bestellen oder Fahrzeug löschen: im Kundenportal.',
  accountProfile: 'Profil',
  accountCustomerNo: 'Kundennummer',
  accountNoPlan:
    'Sie haben noch kein Abo. Abschließen können Sie es im Kundenportal auf der Website.',
  accountPastDue:
    'Die letzte Zahlung ist fehlgeschlagen. Bitte aktualisieren Sie Ihre Zahlungsart im Kundenportal.',
  accountMailLang: 'Sprache der E-Mails',
  accountMailLangHint:
    'In dieser Sprache schicken wir Ihnen E-Mails und Benachrichtigungen. Die App folgt der Sprache Ihres Handys.',
  accountPortalHint:
    'Diese Seiten öffnen sich im Browser. Melden Sie sich dort mit derselben E-Mail-Adresse an.',
  appDevices: 'Handys mit dieser App',
  appDevicesNone: 'Noch kein Handy mit Mitteilungen angemeldet.',
  appDevice: '{platform}, App {version}, zuletzt aktiv am {date}',
  browserPushHint:
    'Browser-Mitteilungen richten Sie im Browser auf der Website ein. Hier sehen und entfernen Sie die Geräte.',
  passkeyAddOnWeb: 'Einen neuen Passkey legen Sie auf der Website an (Abo & Konto).',
  chatErr_filtered:
    'Diese Nachricht kann nicht gesendet werden. Bitte ohne Telefonnummern, Links, Adressen oder Beleidigungen.',
  chatErr_limit_reached: 'Sie haben die höchste Anzahl an Nachrichten erreicht.',
  chatErr_too_long: 'Die Nachricht ist zu lang (höchstens 500 Zeichen).',
  chatErr_chat_not_active: 'Der Chat ist gerade nicht geöffnet.',
  chatErr_rate_limited: 'Bitte etwas langsamer schreiben.',
  tabAlerts: 'Warnungen',
  tabVehicles: 'Fahrzeuge',
  tabAccount: 'Konto',
  tabMore: 'Mehr',
  emptyAlertsTitle: 'Keine Warnungen',
  emptyAlertsText: 'Wenn jemand Ihren Aufkleber scannt, sehen Sie es hier.',
  emptyAlertsAction: 'Aufkleber testen',
  emptyVehiclesTitle: 'Noch kein Fahrzeug',
  emptyVehiclesText: 'Legen Sie Ihr erstes Fahrzeug an. Sein QR-Code ist sofort fertig.',
  decalGuideTitle: 'So bringen Sie den Aufkleber an',
  decalGuideStep1: 'Innenseite der Scheibe sauber und trocken machen.',
  decalGuideStep2:
    'Unten auf der Beifahrerseite anbringen, von außen gut lesbar und ohne die Sicht zu stören.',
  decalGuideStep3: 'Mit „Aufkleber testen“ einmal selbst scannen. Fertig.',
  appVersion: 'Version {version}',
  sendCode: 'Code senden',
  codeTitle: 'Code eingeben',
  codeIntro:
    'Wir haben Ihnen einen 6-stelligen Code an {email} geschickt. Er ist 15 Minuten gültig.',
  codeLabel: 'Anmeldecode',
  codeSubmit: 'Anmelden',
  codeResend: 'Code erneut senden',
  codeResendIn: 'Code erneut senden ({seconds} s)',
  codeResent: 'Wir haben Ihnen einen neuen Code geschickt.',
  codeInvalid: 'Der Code stimmt nicht. Bitte prüfen Sie ihn.',
  codeExpired: 'Der Code ist abgelaufen oder wurde zu oft falsch eingegeben.',
  codeNew: 'Neuen Code anfordern',
  codeOtherEmail: 'Andere E-Mail-Adresse',
  codeHint: 'Tipp: Sie können auch in der E-Mail auf „In der App anmelden“ tippen.',
  signingIn: 'Sie werden angemeldet …',
  signOut: 'Abmelden',
} as const;

export type Key = keyof typeof de;

const en: Record<Key, string> = {
  error: 'That did not work. Please try again.',
  offline: 'No connection. Still trying …',
  back: 'Back',
  signInTitle: 'Sign in',
  signInIntro:
    'Sign in with the e-mail address of your ParkShield account. We send you a sign-in link.',
  email: 'E-mail address',
  sendLink: 'Send sign-in link',
  linkSent: 'We sent a link to {email}. Open it on this phone.',
  pasteLink: 'Paste link',
  pasteHint: 'The link does not open the app? Copy it from the e-mail and paste it here.',
  signInWithLink: 'Sign in with link',
  linkInvalid: 'This link is invalid or already used. Please request a new one.',
  pushTitle: 'Allow notifications',
  pushWhy: 'Without notifications you do not learn about problems with your vehicle right away.',
  pushWhat:
    'A notification contains only the type of alert, such as “Exit blocked”. We load everything else securely when you open the app. Tap “I’m coming” right in the notification to answer at once.',
  pushAllow: 'Continue',
  pushLater: 'Later',
  pushDeniedBanner:
    'Notifications are off. Without notifications you do not learn about problems with your vehicle right away.',
  pushOpenSettings: 'Open settings',
  pushNoFirebase:
    'This version of the app cannot receive notifications (development build without Firebase).',
  alertsTitle: 'Alerts',
  alertsEmpty: 'No alerts yet. When someone scans your decal, you see it here.',
  seen: 'Seen',
  acknowledged: 'Done',
  open: 'Open',
  expired: 'Expired',
  escalated: 'Trusted contact notified',
  test: 'Test',
  photos: '{count, plural, one {# photo} other {# photos}}',
  alertTitle: 'Alert',
  at: '{time}',
  message: 'Message',
  hiddenContent: 'Message from an unconfirmed sender',
  reveal: 'Show',
  coming: 'I’m coming',
  comingDone: 'You sent “I’m coming”. The person at the vehicle sees it.',
  comingByContact: '{name} is taking care of it.',
  comingByContactNoName: 'A trusted contact is taking care of it.',
  in30: 'In about 30 min',
  notNearby: 'I’m not nearby',
  savePhoto: 'Save',
  photoSaved: 'Photo saved.',
  photoAlt: 'Photo {n} of the alert',
  chatOpen: 'Ask a question / open chat',
  chatContinue: 'Go to chat',
  chatBlocked: 'A chat with this sender is not possible.',
  chatPurged: 'The chat history was deleted automatically after 24 hours.',
  senderOnline: 'The sender is online right now',
  senderOffline: 'The sender is no longer online (last seen {minutes} min ago)',
  senderOfflineNever: 'The sender is not online',
  escalationStep: 'Trusted contact {step} of 3 notified: {name}',
  chatTitle: 'Chat',
  chatClose: 'Done / close chat',
  chatClosed: 'The chat has ended.',
  chatPlaceholder: 'Message …',
  chatSend: 'Send',
  chatTyping: 'The sender is typing …',
  chatRemaining: '{count} messages left',
  chatPersonalTitle: 'Share personal details?',
  chatPersonalText:
    'Do you really want to share personal details? Your message seems to contain a phone number, e-mail address or address.',
  chatPersonalSend: 'Send anyway',
  chatPersonalCancel: 'Cancel',
  chatYou: 'You',
  chatScanner: 'Sender',
  chatRead: 'Read',
  notifications: 'Notifications',
  notificationsOn: 'Notifications are on.',
  escalationTitle: 'Escalation to trusted contacts',
  escalationLocked: 'Available with Premium',
  escalationText:
    'If you do not respond, we notify up to 3 trusted contacts one after another by SMS and e-mail.',
  escalationSuggest: 'A trusted contact has agreed. Do you want to switch escalation on now?',
  escalationDelay: 'Waiting time: {minutes} minutes',
  escalationVehicle: 'For this vehicle',
  contacts: 'Trusted contacts',
  contactsEmpty: 'No trusted contacts yet.',
  contactAdd: 'Invite a trusted contact',
  contactName: 'First name',
  contactPhone: 'Mobile number',
  contactEmail: 'E-mail address (optional)',
  ownerName: 'Your first name (shown in the invitation)',
  contactInvite: 'Send invitation',
  contactRemove: 'Remove',
  contactUp: 'Move up',
  contactStatus_pending: 'Invited',
  contactStatus_confirmed: 'Confirmed',
  contactStatus_declined: 'Declined',
  contactStatus_deactivated: 'Deactivated (plan)',
  contactStatus_revoked: 'Withdrawn',
  help: 'Help',
  helpText:
    'The help centre on park-shield.de answers questions about ParkShield. If notifications do not arrive, check Focus modes and the notification settings for ParkShield on your phone.',
  helpOpen: 'Open help',
  vehiclesNone: 'No vehicles yet. Add your first vehicle; its QR code is created at once.',
  decalNone:
    'This vehicle has no valid QR code right now. You get a new one in the customer portal.',
  vehicleAddHint:
    'A nickname and the licence plate are enough. The person at the car sees the nickname, never the plate.',
  vehicleNeedsPlan:
    'A vehicle needs a subscription. You take it out in the customer portal on the website.',
  vehicleInvalid: 'Please check the nickname and plate (letters, digits, spaces and hyphens only).',
  decalSharePdfHint: 'To print, save to Files or send on. Free, at any time.',
  decalShareFailed: 'The print file could not be opened. Please try again.',
  decalTestText:
    'Scan your decal once yourself after putting it on. During the test the alert goes only to you.',
  decalTestOpen: 'The test is open until {time}. Scan the decal with your phone camera now.',
  vehiclePortalHint:
    'Design, replacement decal, ordering a printed decal or deleting the vehicle: in the customer portal.',
  accountProfile: 'Profile',
  accountCustomerNo: 'Customer number',
  accountNoPlan:
    'You have no subscription yet. You can take one out in the customer portal on the website.',
  accountPastDue:
    'The last payment failed. Please update your payment method in the customer portal.',
  accountMailLang: 'E-mail language',
  accountMailLangHint:
    'We send you e-mails and notifications in this language. The app follows the language of your phone.',
  accountPortalHint: 'These pages open in the browser. Sign in there with the same e-mail address.',
  appDevices: 'Phones with this app',
  appDevicesNone: 'No phone with notifications signed in yet.',
  appDevice: '{platform}, app {version}, last active on {date}',
  browserPushHint:
    'You set up browser notifications in the browser on the website. Here you see and remove the devices.',
  passkeyAddOnWeb: 'You add a new passkey on the website (Plan & account).',
  chatErr_filtered:
    'This message cannot be sent. Please leave out phone numbers, links, addresses and insults.',
  chatErr_limit_reached: 'You have reached the maximum number of messages.',
  chatErr_too_long: 'The message is too long (at most 500 characters).',
  chatErr_chat_not_active: 'The chat is not open right now.',
  chatErr_rate_limited: 'Please write a little slower.',
  tabAlerts: 'Alerts',
  tabVehicles: 'Vehicles',
  tabAccount: 'Account',
  tabMore: 'More',
  emptyAlertsTitle: 'No alerts',
  emptyAlertsText: 'When someone scans your decal, you see it here.',
  emptyAlertsAction: 'Test the decal',
  emptyVehiclesTitle: 'No vehicle yet',
  emptyVehiclesText: 'Add your first vehicle. Its QR code is ready at once.',
  decalGuideTitle: 'How to put the decal on',
  decalGuideStep1: 'Clean and dry the inside of the window.',
  decalGuideStep2:
    'Place it low on the passenger side, easy to read from outside and not blocking the view.',
  decalGuideStep3: 'Scan it once yourself with “Test the decal”. Done.',
  appVersion: 'Version {version}',
  sendCode: 'Send code',
  codeTitle: 'Enter code',
  codeIntro: 'We sent a 6-digit code to {email}. It is valid for 15 minutes.',
  codeLabel: 'Sign-in code',
  codeSubmit: 'Sign in',
  codeResend: 'Send code again',
  codeResendIn: 'Send code again ({seconds} s)',
  codeResent: 'We sent you a new code.',
  codeInvalid: 'The code is not correct. Please check it.',
  codeExpired: 'The code has expired or was entered wrongly too often.',
  codeNew: 'Request a new code',
  codeOtherEmail: 'Other e-mail address',
  codeHint: 'Tip: you can also tap “Sign in in the app” in the e-mail.',
  signingIn: 'Signing you in …',
  signOut: 'Sign out',
};

export const messages = { de, en } as const;
export type Lang = keyof typeof messages;

export function deviceLang(): Lang {
  try {
    return getLocales()[0]?.languageCode === 'en' ? 'en' : 'de';
  } catch {
    return 'de';
  }
}

/** Minimal ICU: {name} and {count, plural, one {…} other {…}} with # for the number. */
export function format(template: string, values: Record<string, string | number> = {}): string {
  const plural = /\{(\w+), plural, one \{([^}]*)\} other \{([^}]*)\}\}/g;
  return template
    .replace(plural, (_, k: string, one: string, other: string) => {
      const n = Number(values[k] ?? 0);
      return (n === 1 ? one : other).replace(/#/g, String(n));
    })
    .replace(/\{(\w+)\}/g, (_, k: string) => (values[k] !== undefined ? String(values[k]) : ''));
}

let current: Lang = deviceLang();
export const setLang = (l: Lang) => {
  current = l;
};
export const lang = () => current;
export const t = (key: Key, values?: Record<string, string | number>) =>
  format(messages[current][key], values);
