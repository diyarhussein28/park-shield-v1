# Firebase configuration (not in git)

Push to the ParkShield app goes through Firebase Cloud Messaging (iOS through APNs via FCM).
Put the files of the Firebase project here before a development or store build:

- `google-services.json` (Android app `de.parkshield.app`)
- `GoogleService-Info.plist` (iOS app `de.parkshield.app`; upload the APNs key in the Firebase console)

The API sends with a service account of the same project (`FCM_PROJECT_ID`, `FCM_CLIENT_EMAIL`,
`FCM_PRIVATE_KEY`). Without these files `app.config.ts` leaves the Firebase plugins out: the app runs,
but cannot receive push.
