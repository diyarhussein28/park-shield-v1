import type { DecalSpec } from './layout';

const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );

/** Screen preview (RGB), sized in millimetres so it can also be printed at true size. */
export function renderSvg(spec: DecalSpec, title: string): string {
  const parts: string[] = [];
  for (const p of spec.primitives) {
    if (p.kind === 'rect') {
      const stroke = p.stroke ? ` stroke="${p.stroke.rgb}" stroke-width="0.6"` : '';
      parts.push(
        `<rect x="${p.x}" y="${p.y}" width="${p.w}" height="${p.h}" rx="${p.radius ?? 0}" fill="${p.fill?.rgb ?? 'none'}"${stroke}/>`,
      );
    } else if (p.kind === 'text') {
      parts.push(
        `<text x="${p.x + p.width / 2}" y="${p.y}" font-size="${p.size.toFixed(2)}" font-family="Helvetica, Arial, sans-serif" font-weight="${p.bold ? 700 : 400}" text-anchor="middle" fill="${p.fill.rgb}">${esc(p.text)}</text>`,
      );
    } else {
      const n = p.modules.length;
      const m = p.size / n;
      let d = '';
      p.modules.forEach((row, r) => {
        let c = 0;
        while (c < n) {
          if (!row[c]) {
            c++;
            continue;
          }
          const start = c;
          while (c < n && row[c]) c++;
          d += `M${(p.x + start * m).toFixed(3)} ${(p.y + r * m).toFixed(3)}h${((c - start) * m).toFixed(3)}v${m.toFixed(3)}h-${((c - start) * m).toFixed(3)}z`;
        }
      });
      parts.push(`<path d="${d}" fill="${p.fill.rgb}" shape-rendering="crispEdges"/>`);
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${spec.width} ${spec.height}" width="${spec.width}mm" height="${spec.height}mm" role="img" aria-label="${esc(title)}"><rect width="${spec.width}" height="${spec.height}" fill="${spec.background.rgb}"/>${parts.join('')}</svg>`;
}
