import type { DecalSpec, Primitive } from './layout';

const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );

const n3 = (v: number) => Number(v.toFixed(3));

/** True for modules inside one of the three 7 × 7 finder patterns. */
export function inFinder(r: number, c: number, n: number): boolean {
  return (r < 7 && c < 7) || (r < 7 && c >= n - 7) || (r >= n - 7 && c < 7);
}

/** Top-left corners (row, col) of the three finder patterns. */
export const finderOrigins = (n: number): [number, number][] => [
  [0, 0],
  [0, n - 7],
  [n - 7, 0],
];

function qr(p: Extract<Primitive, { kind: 'qr' }>): string {
  const n = p.modules.length;
  const m = p.size / n;
  let d = '';
  p.modules.forEach((row, r) => {
    let c = 0;
    while (c < n) {
      if (!row[c] || (p.roundFinders && inFinder(r, c, n))) {
        c++;
        continue;
      }
      const start = c;
      while (c < n && row[c] && !(p.roundFinders && inFinder(r, c, n))) c++;
      d += `M${n3(p.x + start * m)} ${n3(p.y + r * m)}h${n3((c - start) * m)}v${n3(m)}h-${n3((c - start) * m)}z`;
    }
  });
  let out = `<path d="${d}" fill="${p.fill.rgb}" shape-rendering="crispEdges"/>`;
  if (p.roundFinders) {
    for (const [r, c] of finderOrigins(n)) {
      const x = p.x + c * m;
      const y = p.y + r * m;
      out +=
        `<rect x="${n3(x)}" y="${n3(y)}" width="${n3(7 * m)}" height="${n3(7 * m)}" rx="${n3(2 * m)}" fill="${p.fill.rgb}"/>` +
        `<rect x="${n3(x + m)}" y="${n3(y + m)}" width="${n3(5 * m)}" height="${n3(5 * m)}" rx="${n3(1.4 * m)}" fill="#ffffff"/>` +
        `<rect x="${n3(x + 2 * m)}" y="${n3(y + 2 * m)}" width="${n3(3 * m)}" height="${n3(3 * m)}" rx="${n3(0.9 * m)}" fill="${p.fill.rgb}"/>`;
    }
  }
  return out;
}

/** Parallelograms leaning right, `step` wide, covering the rectangle (clipped by the caller). */
export function stripeQuads(p: Extract<Primitive, { kind: 'stripes' }>): [number, number][][] {
  const quads: [number, number][][] = [];
  for (let sx = p.x - p.h; sx < p.x + p.w + p.h; sx += 2 * p.step) {
    quads.push([
      [sx, p.y + p.h],
      [sx + p.step, p.y + p.h],
      [sx + p.step + p.h, p.y],
      [sx + p.h, p.y],
    ]);
  }
  return quads;
}

/** Screen preview (RGB), sized in millimetres so it can also be printed at true size. */
export function renderSvg(spec: DecalSpec, title: string): string {
  const parts: string[] = [];
  spec.primitives.forEach((p, i) => {
    if (p.kind === 'rect') {
      const stroke = p.stroke ? ` stroke="${p.stroke.rgb}" stroke-width="0.6"` : '';
      parts.push(
        `<rect x="${n3(p.x)}" y="${n3(p.y)}" width="${n3(p.w)}" height="${n3(p.h)}" rx="${n3(p.radius ?? 0)}" fill="${p.fill?.rgb ?? 'none'}"${stroke}/>`,
      );
    } else if (p.kind === 'text') {
      const align = p.align ?? 'center';
      const x = align === 'left' ? p.x : align === 'right' ? p.x + p.width : p.x + p.width / 2;
      const anchor = align === 'left' ? 'start' : align === 'right' ? 'end' : 'middle';
      parts.push(
        `<text x="${n3(x)}" y="${n3(p.y)}" font-size="${p.size.toFixed(2)}" font-family="Helvetica, Arial, sans-serif" font-weight="${p.bold ? 700 : 400}" text-anchor="${anchor}" fill="${p.fill.rgb}">${esc(p.text)}</text>`,
      );
    } else if (p.kind === 'path') {
      const stroke = p.stroke
        ? ` stroke="${p.stroke.rgb}" stroke-width="${p.strokeWidth ?? 2}" stroke-linecap="round" stroke-linejoin="round"`
        : '';
      parts.push(
        `<path transform="translate(${n3(p.x)} ${n3(p.y)}) scale(${n3(p.size / p.box)})" d="${p.d}" fill="${p.fill?.rgb ?? 'none'}"${stroke}/>`,
      );
    } else if (p.kind === 'stripes') {
      const id = `ps-clip-${i}`;
      const quads = stripeQuads(p)
        .map(
          (q) =>
            `<path d="M${q.map(([x, y]) => `${n3(x)} ${n3(y)}`).join('L')}Z" fill="${p.a.rgb}"/>`,
        )
        .join('');
      parts.push(
        `<clipPath id="${id}"><rect x="${n3(p.x)}" y="${n3(p.y)}" width="${n3(p.w)}" height="${n3(p.h)}"/></clipPath>` +
          `<g clip-path="url(#${id})"><rect x="${n3(p.x)}" y="${n3(p.y)}" width="${n3(p.w)}" height="${n3(p.h)}" fill="${p.b.rgb}"/>${quads}</g>`,
      );
    } else {
      parts.push(qr(p));
    }
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${spec.width} ${spec.height}" width="${spec.width}mm" height="${spec.height}mm" role="img" aria-label="${esc(title)}"><rect width="${spec.width}" height="${spec.height}" fill="${spec.background.rgb}"/>${parts.join('')}</svg>`;
}
