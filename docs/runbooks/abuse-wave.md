# Abuse wave (SEV2)

Examples: a decal photo shared online and hundreds of people send alerts; one person harasses several
owners; insults slip through the filter; many owner reports in an hour.

## Recognise it

- Ops app → **Missbrauch**: pattern alerts (code with more than `abuse.code_alerts_per_hour` alerts,
  scanner alerting ≥ 3 vehicles or reported by ≥ 2 owners in a day, fake-decal reports).
- Owner reports in the same view; support tickets tagged `topic_abuse`.

## Contain

1. **One code flooded** (decal photo leaked): Missbrauch → the code → **Code für den Halter sperren**.
   The owner gets an e-mail, a new code and a free replacement decal. The old decal shows "nicht aktiv".
2. **One scanner harassing**: **Bis Tagesende überall sperren** on the pattern (lasts until the end of the day,
   the reference changes daily by design). Per-vehicle 30-day blocks happen automatically when the
   owner reports.
3. **Wave across many codes** (organised): lower limits for the day in **Einstellungen**
   (`abuse.*` thresholds) and, if needed, the rate limits `ratelimit.alert.scanner_global` and
   `ratelimit.alert.vehicle`; changes apply within seconds and are audited. Put them back afterwards.
4. **Filter bypass** (new insult spelling): Missbrauch → **Wortlisten** → add the words → publish. Live
   at once; roll back if it blocks legitimate messages (review sample in **Prüfung**).
5. Threats against a person: support contacts the owner; recommend a police report. We hand over data
   only on a legal request (privacy lead decides; break-glass with ticket reference).

## Afterwards

- WhatsApp: a wave of reports can lower Meta's quality rating; check **Anbieter**.
- Note the false-positive rate for the week in **Prüfung**; tune the word list if it rose.
