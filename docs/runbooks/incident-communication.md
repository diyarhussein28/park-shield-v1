# Incident communication

The public status page is `https://status.parkshield.de` (Better Stack, `infra/monitoring`). Its
components follow what customers notice: "Scan-Seite", "Zustellung der Warnungen", "Website und
Kundenkonto". The monitors set the status automatically; the incident text is written by the person
leading the incident.

## When and how often

- SEV1: first post within 15 minutes, then every 30 minutes, and when resolved.
- SEV2: first post within 30 minutes, then every 60 minutes.
- Planned maintenance: announce 3 days ahead; never during evening rush hours (17–20 h).

## Rules

- German first, then English, in the same post. Plain words: what does not work, what still works,
  what customers can do. No blame, no guesses about causes, no internal names.
- Never say data is safe before the privacy lead has confirmed it.
- Support (Zammad) uses the same wording; the macro "Störung" links the status page.
- Customers are e-mailed directly only for SEV1 lasting more than 2 hours or when data may be affected
  (service broadcast AD-19 is phase 2: until then the privacy lead sends it through Brevo with the
  template below).

## Templates

**Investigating**
> DE: Wir untersuchen gerade Probleme bei {Komponente}. Warnungen können verzögert ankommen. Wir melden uns spätestens um {Uhrzeit}.
> EN: We are investigating problems with {component}. Alerts may arrive late. Next update by {time}.

**Identified, channel switched off**
> DE: {Kanal} ist bei unserem Anbieter gestört. Wir haben ihn vorübergehend abgeschaltet; Warnungen kommen über Push und E-Mail.
> EN: {Channel} has an outage at our provider. We switched it off for now; alerts arrive by push and e-mail.

**Resolved**
> DE: Seit {Uhrzeit} funktioniert {Komponente} wieder. Warnungen aus der Zwischenzeit wurden zugestellt. Entschuldigen Sie die Störung.
> EN: {Component} has been working again since {time}. Alerts from the meantime have been delivered. We are sorry for the disruption.

**Fake decals**
> DE: Achtung: Es sind gefälschte Aufkleber im Umlauf. ParkShield verlangt nie eine Zahlung; echte Codes öffnen nur s.parkshield.de.
> EN: Warning: fake decals are circulating. ParkShield never asks for payment; real codes only open s.parkshield.de.

**Customer e-mail (SEV1 > 2 h)**
> Betreff: Störung bei ParkShield am {Datum}
> Zwischen {Beginn} und {Ende} konnten Warnungen {nicht / nur verzögert} zugestellt werden. {Was passiert ist, ein Satz.} Ihr Schutz ist wieder vollständig aktiv. Wenn Sie in dieser Zeit eine Warnung erwartet haben, sehen Sie sie in Ihrem Konto unter „Verlauf“. Wir entschuldigen uns für die Störung.
