# Fake decals (SEV2)

Fake decals imitate ParkShield to collect phone numbers or payments ("scan and pay a fee"). Our page
never asks scanners for money or personal data, and says so in every footer.

## Recognise it

- Ops app → **Missbrauch** → reports of kind `fake_decal` (scanner page link "Aufkleber sieht
  verdächtig aus?") and the pattern "fake decals".
- Support tickets, social media, police enquiries.
- A real decal always points to `https://<scanner domain>/s/<10 characters>`. Anything else is fake.

## Act

1. Collect: photos, the URL or QR target, location, date. Never visit payment links from a work laptop
   without isolation.
2. If the URL is ours but the code is unknown: it is a copied design with invalid codes; the scanner
   page already shows "nicht aktiv". If many such scans come from one area, note it for the police.
3. If the URL is a look-alike domain: report it (registrar abuse contact, Google Safe Browsing,
   `phishing@` of the hosting provider) and to the police (online report of the Land). Tell the
   privacy lead if customer data may be involved.
4. Status page / website notice if it spreads: "ParkShield-Aufkleber verlangen nie eine Zahlung. Echte
   Codes öffnen nur s.parkshield.de." Social media post with the same text and a photo of a real decal.
5. Owners who report a fake decal on their own car: revoke their code if the real one may have been
   copied (free replacement, see [abuse-wave](abuse-wave.md)).
