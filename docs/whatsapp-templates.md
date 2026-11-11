# WhatsApp message templates (360dialog / Meta)

The four templates the code sends (`apps/api/src/providers/whatsapp.ts`, `WhatsAppTemplate` in
`providers/ports.ts`). Create each one in the 360dialog hub in **German (`de`)** and **English
(`en`)**: the code sends the owner's language as the language code, so the language must be exactly
"German" and "English" (not "English (US)" / `en_US`).

Names, categories, variable order and button order must match exactly, or Meta rejects the message.

| Template      | Category       | Variables                                    | Buttons                                        |
| ------------- | -------------- | -------------------------------------------- | ---------------------------------------------- |
| `ps_alert`    | Utility        | `{{1}}` problem (alert type), `{{2}}` nickname | 3 quick replies, in this order (see below)     |
| `ps_followup` | Utility        | `{{1}}` problem, `{{2}}` nickname              | the same 3 quick replies                       |
| `ps_test`     | Utility        | `{{1}}` nickname                               | the same 3 quick replies                       |
| `ps_otp`      | Authentication | `{{1}}` 6-digit code (valid 10 min)            | Copy code (one-time password, "Copy code")     |

Quick-reply order matters: the code sends button payloads by index (0 = coming, 1 = in 30 min,
2 = not nearby, `OWNER_REPLIES` in `notifications/ack.service.ts`).

| Index | German                  | English           |
| ----- | ----------------------- | ----------------- |
| 0     | `Ich komme`             | `I'm coming`      |
| 1     | `In ca. 30 Min`         | `In about 30 min` |
| 2     | `Bin nicht in der Nähe` | `I'm not nearby`  |

Meta rules these texts already follow: the body must not start or end with a variable, and every
variable needs a sample value when you submit.

## `ps_alert` (Utility)

**German body**

```text
ParkShield-Warnung: {{1}} bei Ihrem Fahrzeug „{{2}}“.

Jemand hat Ihren Aufkleber gescannt und wartet auf Ihre Antwort. Bitte tippen Sie unten auf eine Antwort.
```

**English body**

```text
ParkShield alert: {{1}} at your vehicle "{{2}}".

Someone scanned your decal and is waiting for your reply. Please tap one of the answers below.
```

Footer (optional, both languages): `Ihre Nummer bleibt geheim.` / `Your number stays private.`

Samples: `{{1}}` = `Fahrzeug versperrt Ausfahrt` / `Vehicle is blocking an exit`, `{{2}}` =
`Der Blaue` / `The blue one`.

## `ps_followup` (Utility)

**German body**

```text
Erinnerung von ParkShield: {{1}} bei Ihrem Fahrzeug „{{2}}“.

Die Person vor Ort wartet noch auf Sie. Bitte antworten Sie kurz.
```

**English body**

```text
ParkShield reminder: {{1}} at your vehicle "{{2}}".

The person at your car is still waiting for you. Please reply briefly.
```

Samples: as for `ps_alert`.

## `ps_test` (Utility)

Sent after a WhatsApp number is linked and by "Testwarnung senden".

**German body**

```text
Test erfolgreich: ParkShield-Warnungen für „{{1}}“ erreichen Sie jetzt per WhatsApp.

So sieht eine echte Warnung aus. Die Antwort-Knöpfe funktionieren genauso.
```

**English body**

```text
Test successful: ParkShield alerts for "{{1}}" now reach you on WhatsApp.

This is what a real alert looks like. The reply buttons work the same way.
```

Sample: `{{1}}` = `Der Blaue` / `The blue one`.

## `ps_otp` (Authentication)

Meta writes the text of authentication templates itself; you only pick the options:

- Code delivery: **Copy code**, button text `Code kopieren` / `Copy code`.
- Add the security recommendation ("Teilen Sie diesen Code nicht" / "Do not share this code"): yes.
- Code expiry: **10 minutes** (the code is valid for 10 minutes, `OTP_TTL` in
  `channels/channels.service.ts`).
