# WhatsApp message templates (Twilio / Meta)

The four templates the code sends (`WhatsAppTemplate` in `apps/api/src/providers/ports.ts`). Create
each one in **German** and **English**. The texts below are the same for Twilio (default,
`providers/twilio-whatsapp.ts`) and 360dialog (`WHATSAPP_PROVIDER=360dialog`,
`providers/whatsapp.ts`).

## Creating them in Twilio

Console → **Messaging → Content Template Builder → Create new**. One template per name **and**
language, so eight in total; each gets a Content SID (`HX…`) that goes into `.env`:

| Template      | Content type                 | Language | `.env` variable                   |
| ------------- | ---------------------------- | -------- | --------------------------------- |
| `ps_alert`    | Quick reply                  | German   | `TWILIO_CONTENT_PS_ALERT_DE`      |
| `ps_alert`    | Quick reply                  | English  | `TWILIO_CONTENT_PS_ALERT_EN`      |
| `ps_followup` | Quick reply                  | German   | `TWILIO_CONTENT_PS_FOLLOWUP_DE`   |
| `ps_followup` | Quick reply                  | English  | `TWILIO_CONTENT_PS_FOLLOWUP_EN`   |
| `ps_test`     | Quick reply                  | German   | `TWILIO_CONTENT_PS_TEST_DE`       |
| `ps_test`     | Quick reply                  | English  | `TWILIO_CONTENT_PS_TEST_EN`       |
| `ps_otp`      | Authentication (WhatsApp)    | German   | `TWILIO_CONTENT_PS_OTP_DE`        |
| `ps_otp`      | Authentication (WhatsApp)    | English  | `TWILIO_CONTENT_PS_OTP_EN`        |

Name each template like `ps_alert_de`, set the category as below and submit it for **WhatsApp
approval**.

**Button IDs are variables.** Each quick-reply button has a title (what the owner sees) and an ID
(what comes back when tapped). The code fills the IDs with `ack:<reply token>:<reply>` per message,
so enter the IDs as the variables that follow the body variables:

| Template                   | Body variables         | Button 1 ID | Button 2 ID | Button 3 ID |
| -------------------------- | ---------------------- | ----------- | ----------- | ----------- |
| `ps_alert`, `ps_followup`  | `{{1}}` problem, `{{2}}` nickname | `{{3}}` | `{{4}}` | `{{5}}` |
| `ps_test`                  | `{{1}}` nickname       | `{{2}}`     | `{{3}}`     | `{{4}}`     |

Sample values for the ID variables: `ack:sample:coming`, `ack:sample:in_30_min`,
`ack:sample:not_nearby`.

## Templates and buttons

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

Sent after a WhatsApp number is linked and by "Testwarnung senden". In Twilio it is named
`ps_test_v2_de` / `ps_test_v2_en`: the first wording ("Test erfolgreich … So sieht eine echte Warnung
aus") was re-categorised by Meta as **Marketing**, so the text is now a plain account notification.
Submit it as Utility with category changes **not** allowed.

**German body**

```text
Ihre WhatsApp-Nummer ist jetzt mit ParkShield verbunden. Warnungen zu Ihrem Fahrzeug „{{1}}“ werden ab sofort hierher zugestellt.

Bei einer Warnung antworten Sie mit einem der Knöpfe unten.
```

**English body**

```text
Your WhatsApp number is now connected to ParkShield. Alerts for your vehicle "{{1}}" will be delivered here from now on.

When an alert arrives, reply with one of the buttons below.
```

Sample: `{{1}}` = `Der Blaue` / `The blue one`.

## `ps_otp` (Authentication)

Meta writes the text of authentication templates itself; you only pick the options:

- Code delivery: **Copy code**, button text `Code kopieren` / `Copy code`.
- Add the security recommendation ("Teilen Sie diesen Code nicht" / "Do not share this code"): yes.
- Code expiry: **10 minutes** (the code is valid for 10 minutes, `OTP_TTL` in
  `channels/channels.service.ts`).
