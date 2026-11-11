import { inflateSync } from 'node:zlib';
import { DECAL_PRODUCTS, DECAL_TEMPLATES } from '@parkshield/shared';
import jsQR from 'jsqr';
import { describe, expect, it } from 'vitest';
import { FIXED_SENTENCE, layoutDecal, type Primitive } from './layout';
import { BLEED_MM, renderHomePdf, renderPrintPdf } from './pdf';
import { renderSvg } from './svg';

const base = {
  code: 'K7QX4M2R9T',
  scannerBaseUrl: 'https://pkshd.de',
  cta: 'Blockiere ich Sie? Bitte scannen',
} as const;

/** Rasterises the QR primitive (4 px per module, 4-module quiet zone) and decodes it like a phone would. */
function decode(qr: Extract<Primitive, { kind: 'qr' }>): string | null {
  const n = qr.modules.length;
  const scale = 4;
  const size = (n + 8) * scale;
  const px = new Uint8ClampedArray(size * size * 4).fill(255);
  qr.modules.forEach((row, r) =>
    row.forEach((dark, c) => {
      if (!dark) return;
      for (let dy = 0; dy < scale; dy++)
        for (let dx = 0; dx < scale; dx++) {
          const i = (((r + 4) * scale + dy) * size + (c + 4) * scale + dx) * 4;
          px[i] = px[i + 1] = px[i + 2] = 0;
        }
    }),
  );
  return jsQR(px, size, size)?.data ?? null;
}

describe('decal layout (US-10)', () => {
  for (const product of DECAL_PRODUCTS) {
    for (const template of DECAL_TEMPLATES) {
      it(`${product}/${template}: QR decodes to the decal URL and trust cues are present`, () => {
        const spec = layoutDecal({ ...base, template, product });
        const qr = spec.primitives.find((p) => p.kind === 'qr')!;
        expect(decode(qr as Extract<Primitive, { kind: 'qr' }>)).toBe(
          'https://pkshd.de/s/K7QX4M2R9T',
        );
        const texts = spec.primitives.filter((p) => p.kind === 'text').map((p) => p.text);
        expect(texts).toContain(base.cta);
        expect(texts).toContain('pkshd.de/s/K7QX4M2R9T'); // domain printed next to the QR (SC-15)
        expect(texts).toContain(FIXED_SENTENCE);
        for (const p of spec.primitives) {
          if (p.kind === 'text') {
            expect(p.x).toBeGreaterThanOrEqual(3);
            expect(p.x + p.width).toBeLessThanOrEqual(spec.width - 3);
            expect(p.y).toBeLessThanOrEqual(spec.height - 2);
          }
        }
      });
    }
  }

  it('sizes the vinyl sticker at 8 × 8 cm and the dashboard card at A6', () => {
    expect(
      layoutDecal({ ...base, template: 'classic', product: 'uv_vinyl_sticker' }),
    ).toMatchObject({
      width: 80,
      height: 80,
    });
    expect(
      layoutDecal({ ...base, template: 'classic', product: 'a6_dashboard_card' }),
    ).toMatchObject({
      width: 105,
      height: 148,
    });
  });

  it('shrinks long headers to fit', () => {
    const short = layoutDecal({
      ...base,
      cta: 'Hallo',
      template: 'classic',
      product: 'uv_vinyl_sticker',
    });
    const long = layoutDecal({
      ...base,
      cta: 'X'.repeat(40),
      template: 'classic',
      product: 'uv_vinyl_sticker',
    });
    const size = (s: typeof short) =>
      (s.primitives.find((p) => p.kind === 'text') as { size: number }).size;
    expect(size(long)).toBeLessThan(size(short));
  });
});

describe('renderers', () => {
  const spec = layoutDecal({ ...base, template: 'classic', product: 'uv_vinyl_sticker' });

  it('SVG preview is sized in millimetres and escapes text', () => {
    const svg = renderSvg(
      layoutDecal({
        ...base,
        cta: 'Licht <an> & "aus"',
        template: 'night',
        product: 'uv_vinyl_sticker',
      }),
      'Vorschau',
    );
    expect(svg).toMatch(/^<svg [^>]*width="80mm" height="80mm"/);
    expect(svg).toContain('Licht &lt;an&gt; &amp; &quot;aus&quot;');
    expect(svg).toContain('crispEdges');
  });

  it('print PDF is CMYK with 3 mm bleed and trim/bleed boxes', async () => {
    const pdf = (await renderPrintPdf(spec, 'Decal')).toString('latin1');
    const pt = (mm: number) => (mm * 72) / 25.4;
    expect(pdf.startsWith('%PDF-')).toBe(true);
    const media = /\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/.exec(pdf)!;
    expect(Number(media[1])).toBeCloseTo(pt(80 + 2 * BLEED_MM), 1);
    expect(pdf).toMatch(/\/TrimBox \[8\.50\d* 8\.50\d* 235\.27\d* 235\.27\d*\]/);
    expect(pdf).toContain('/BleedBox');
    // Page content is deflated; inflate it and check every fill uses the CMYK colour space.
    const raw = await renderPrintPdf(spec, 'Decal');
    const content = [...raw.toString('latin1').matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)]
      .map((m) => {
        try {
          return inflateSync(Buffer.from(m[1]!, 'latin1')).toString('latin1');
        } catch {
          return '';
        }
      })
      .join('\n');
    expect(content).toContain('/DeviceCMYK cs');
    expect(content).toContain('0.87 0.64 0 0.15 scn'); // classic blue header
    expect(content).not.toMatch(/DeviceRGB|\brg\b/); // no RGB anywhere in the print file
  });

  it('home-print PDF is A4', async () => {
    const pdf = (await renderHomePdf(spec, 'Decal')).toString('latin1');
    expect(pdf).toMatch(/\/MediaBox \[0 0 595\.2\d* 841\.8\d*\]/);
  });
});
