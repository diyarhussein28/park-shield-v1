# ParkShield logo files

Rendered by `npx tsx scripts/brand-assets.ts` from the one definition of the mark
(`apps/web/lib/brand-mark.ts`) and Plus Jakarta Sans ExtraBold (OFL, `apps/api/assets/fonts`); the
wordmark is outlined, so the SVGs need no font. Do not edit by hand: change `brand-mark.ts` and re-run.

| File                                          | Use                                                                 |
| --------------------------------------------- | ------------------------------------------------------------------- |
| `parkshield-logo.svg` / `.png` / `.pdf`       | full logo on light backgrounds (dark „Park“, blue „Shield“)         |
| `parkshield-logo-white.svg` / `.png` / `.pdf` | full logo on dark backgrounds (white „Park“, lighter blue „Shield“) |
| `parkshield-mark.svg` / `.png` / `.pdf`       | the shield alone (app icons, avatars)                               |

PNGs have a transparent background (logos 1200 px wide, mark 1024 px).

The PDFs are vector (paths and a real gradient, no images, glyphs as exact cubic curves), for print
shops and design tools; the white logo is meant for a dark background.
