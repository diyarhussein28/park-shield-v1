// Renders the sample decals shown on the landing page with the real decal layout (US-04 redesign).
//   npx tsx scripts/landing-decals.ts
// The QR codes point at the home page, so scanning the picture never hits a real scanner page.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { layoutDecal } from '../apps/api/src/decal/layout.ts';
import { renderSvg } from '../apps/api/src/decal/svg.ts';
import { ROOT } from './lib/paths.ts';

for (const template of ['bold', 'classic', 'night'] as const) {
  const spec = layoutDecal({
    code: 'BEISPIEL',
    scannerBaseUrl: 'https://parkshield.de',
    template,
    cta: 'Blockiere ich Sie? Bitte scannen',
    product: 'uv_vinyl_sticker',
  });
  // Decorative on the page (aria-hidden), so no role/label and no fixed millimetre size.
  const svg = renderSvg(spec, 'ParkShield')
    .replace(/ width="[\d.]+mm" height="[\d.]+mm" role="img" aria-label="[^"]*"/, '')
    .replace('<svg ', '<svg aria-hidden="true" ');
  writeFileSync(join(ROOT, 'apps', 'web', 'public', 'images', `decal-${template}.svg`), svg);
}
console.log('wrote apps/web/public/images/decal-*.svg');
