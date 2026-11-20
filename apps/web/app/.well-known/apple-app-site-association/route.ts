// iOS Universal Links for the ParkShield app: alert links and the app's sign-in link open the app.
// APP_IOS_TEAM_ID and APP_IOS_BUNDLE_ID come from the Apple developer account (empty: no app yet).
export const dynamic = 'force-dynamic';

export function GET() {
  const team = process.env.APP_IOS_TEAM_ID ?? '';
  const bundle = process.env.APP_IOS_BUNDLE_ID ?? 'de.parkshield.app';
  const details = team
    ? [
        {
          appIDs: [`${team}.${bundle}`],
          components: [
            { '/': '/app/alerts/*', comment: 'Alert detail (push, e-mail)' },
            { '/': '/app/anmelden', comment: 'Sign-in link for the app' },
          ],
        },
      ]
    : [];
  return Response.json(
    { applinks: { details } },
    { headers: { 'cache-control': 'public, max-age=3600' } },
  );
}
