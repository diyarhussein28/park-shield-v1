# Provider outage: WhatsApp, e-mail or push (SEV2, SEV1 if all channels)

ParkShield sends every normal alert to the first channel that works and urgent alerts to all
channels (US-22). One provider failing therefore delays nothing as long as the kill switch is used:
a switched-off channel is skipped at once instead of failing and retrying.

## Recognise it

- Ops app → **Anbieter**: `whatsapp.failures`, `email.failures` or `webpush.failures` critical;
  for WhatsApp also `whatsapp.quality` RED or a template PAUSED/DISABLED. The team gets an e-mail.
- Logs: `outbox handler failed` with the provider's error, many `alert_deliveries` in `failed`.
- Status pages of 360dialog / Meta, Brevo, Apple / Google push.

## WhatsApp (360dialog / Meta)

1. Ops app → **Einstellungen** → Kill Switches → **WhatsApp** → reason ("360dialog outage, ticket …")
   → **Abschalten**. Applies within seconds in every process (settings broadcast).
2. Check in **Anbieter** that new WhatsApp attempts appear as `suppressed / kill_switch` and that push
   and e-mail deliveries succeed.
3. If the cause is Meta's **quality rating** (RED) or a **paused template**: do not switch back on until
   the rating is GREEN/YELLOW again; check the last week of custom messages for spam in the abuse
   centre (a flood of reports lowers the rating).
4. Status page: "WhatsApp-Benachrichtigungen verzögert/aus; Push und E-Mail funktionieren."
5. When the provider recovers: switch on with a reason, watch `whatsapp.failures` for 30 minutes.

## E-mail (Brevo)

E-mail is also the sign-in channel (magic links): a Brevo outage stops new sign-ins, not alerts on
other channels.

1. Kill switch **E-Mail** only if alerts are failing and customers have other channels; otherwise
   leave it on (failed deliveries retry with backoff for about 1.5 hours).
2. Status page: "Anmeldelinks und E-Mail-Warnungen kommen verzögert."
3. Passkey sign-in keeps working; tell support to point customers to it.

## Push (Web Push)

Push goes straight to Apple / Google / Mozilla push services. A failure for one platform
(`webpush.failures` per platform) usually means that service has an outage or our VAPID keys were
rejected.

1. Platform outage: kill switch **Push** only if most deliveries fail; e-mail and WhatsApp take over.
2. "VAPID key rejected" (403 for all): the key pair in the secrets changed. Restore the previous key
   pair from SOPS; changing keys invalidates every subscription.

## All channels down

SEV1. Follow the steps above for each provider, post on the status page, and check the worker first:
if the **worker heartbeat** is red, the problem is the worker or the database, not the providers
([database-outage](database-outage.md)).
