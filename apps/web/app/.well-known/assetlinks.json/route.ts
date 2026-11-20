// Android App Links for the ParkShield app (verified https links open the app).
// APP_ANDROID_PACKAGE and APP_ANDROID_SHA256 (comma-separated signing-key fingerprints, from Play
// Console → App integrity) come from the release setup; empty: no app yet.
export const dynamic = 'force-dynamic';

export function GET() {
  const pkg = process.env.APP_ANDROID_PACKAGE ?? 'de.parkshield.app';
  const prints = (process.env.APP_ANDROID_SHA256 ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const body = prints.length
    ? [
        {
          relation: ['delegate_permission/common.handle_all_urls'],
          target: { namespace: 'android_app', package_name: pkg, sha256_cert_fingerprints: prints },
        },
      ]
    : [];
  return Response.json(body, { headers: { 'cache-control': 'public, max-age=3600' } });
}
