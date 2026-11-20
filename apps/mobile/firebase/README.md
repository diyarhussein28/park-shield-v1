# Firebase configuration (not in git)

Push to the ParkShield app goes through Firebase Cloud Messaging (iOS through APNs via FCM).
Put the files of the Firebase project here before a development or store build:

- `google-services.json` (Android app `de.parkshield.app`)
- `GoogleService-Info.plist` (iOS app `de.parkshield.app`; upload the APNs key in the Firebase console)

The API sends with a service account of the same project (`FCM_PROJECT_ID`, `FCM_CLIENT_EMAIL`,
`FCM_PRIVATE_KEY`). Without these files `app.config.ts` leaves the Firebase plugins out: the app runs,
but cannot receive push. Expo Go can never receive push; a real build is needed.

## iPhone: from nothing to the first push

Needs a paid Apple Developer Program membership and an Expo account. Keys and files never go into git,
chat or messengers.

1. **Firebase project** (console.firebase.google.com): create the project „ParkShield“ (Google
   Analytics off), add an **iOS app** with bundle ID `de.parkshield.app`, download
   `GoogleService-Info.plist` into this folder.
2. **APNs key** (developer.apple.com → Certificates, Identifiers & Profiles → Keys → „+“): name it
   „ParkShield APNs“, tick **Apple Push Notifications service (APNs)**, download the `.p8` file (only
   possible once; keep it offline) and note the **Key ID**. In Firebase → Project settings → Cloud
   Messaging → Apple app configuration → **APNs authentication key**: upload the `.p8` with the Key ID
   and your **Team ID** (Apple account → Membership).
3. **Server key** (Firebase → Project settings → Service accounts → Generate new private key): put
   `project_id`, `client_email` and `private_key` into `FCM_PROJECT_ID`, `FCM_CLIENT_EMAIL` and
   `FCM_PRIVATE_KEY` in `infra/single/server.env` on the server (edit it there), then restart `api`
   and `worker`. Delete the downloaded JSON afterwards.
4. **EAS** (in `apps/mobile`): `npx eas-cli@latest login`, then `npx eas-cli@latest init` (links the
   project; add the printed `projectId` under `extra.eas.projectId` in `app.config.ts`).
   The plist is git-ignored, so EAS does not upload it: add it in the Expo dashboard → Project →
   Environment variables as a **file** variable named `GOOGLE_SERVICE_PLIST`, visibility **Secret**,
   environments **preview** and **production** (`app.config.ts` reads its path). Keep the local copy
   here too, so the config resolves the same way on your machine.
5. **Register the iPhone**: `npx eas-cli@latest device:create`, open the link on the iPhone and install
   the profile. A new device can take a while before Apple lets builds install on it.
6. **Test build** (talks to https://test.park-shield.de):

   ```bash
   npx eas-cli@latest build --platform ios --profile preview
   ```

   EAS asks for your Apple ID sign-in to create the certificate and the ad hoc profile; answer the
   sign-in and 2FA yourself. Install the build from the link or QR code.

7. **Check**: open the app, sign in, allow notifications. On „Benachrichtigungen“ the line „App“ no
   longer says „noch nicht eingerichtet“; a test scan of your decal arrives as a push.

Store build later: `--profile production` (talks to https://park-shield.de), then
`npx eas-cli@latest submit --platform ios`.
