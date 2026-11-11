// Minimal single-page PDF (Helvetica, Latin-1) for the local fake invoice. Real invoices come from Stripe.
export function simplePdf(lines: string[]): Buffer {
  const esc = (s: string) => s.replace(/[\\()]/g, (c) => `\\${c}`);
  const text = lines
    .map((l, i) => `BT /F1 ${i === 0 ? 18 : 11} Tf 56 ${780 - i * 22} Td (${esc(l)}) Tj ET`)
    .join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${Buffer.byteLength(text, 'latin1')} >>\nstream\n${text}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
  ];
  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((o, i) => {
    offsets.push(Buffer.byteLength(body, 'latin1'));
    body += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = Buffer.byteLength(body, 'latin1');
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  body += offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, 'latin1');
}

const LINES_PER_PAGE = 48;
const WRAP = 96;

/** Characters Helvetica/WinAnsi can show; anything else becomes "?" (the JSON export is exact). */
const latin1 = (s: string) =>
  s
    .replace(/[“”„]/g, '"')
    .replace(/[‘’‚]/g, "'")
    .replace(/[–—]/g, '-')
    .replace(/•/g, '*')
    .replaceAll(String.fromCharCode(0x202f), '\xa0') // narrow no-break space (Intl number formats)
    // WinAnsiEncoding puts the euro sign at 0x80 (credit notes, US-40).
    .replace(/€/g, '\x80')
    .replace(/[^\x20-\x7e\x80\xa0-\xff]/g, '?');

function wrap(line: string): string[] {
  const out: string[] = [];
  let rest = line;
  while (rest.length > WRAP) {
    const cut = rest.lastIndexOf(' ', WRAP);
    const at = cut > 20 ? cut : WRAP;
    out.push(rest.slice(0, at));
    rest = '    ' + rest.slice(at).trimStart();
  }
  out.push(rest);
  return out;
}

/** Multi-page text document (data export, OW-12). Lines starting with "# " are headings. */
export function textPdf(title: string, lines: string[]): Buffer {
  const esc = (s: string) => latin1(s).replace(/[\\()]/g, (c) => `\\${c}`);
  const all = lines.flatMap((l) => (l.startsWith('# ') ? [l] : wrap(l)));
  const pages: string[][] = [];
  for (let i = 0; i < all.length; i += LINES_PER_PAGE) pages.push(all.slice(i, i + LINES_PER_PAGE));
  if (!pages.length) pages.push([]);

  const streams = pages.map((page, p) => {
    const header = p === 0 ? `BT /F2 16 Tf 56 800 Td (${esc(title)}) Tj ET\n` : '';
    const body = page
      .map((l, i) => {
        const heading = l.startsWith('# ');
        const y = 772 - i * 15;
        return `BT /${heading ? 'F2' : 'F1'} ${heading ? 11 : 9} Tf 56 ${y} Td (${esc(heading ? l.slice(2) : l)}) Tj ET`;
      })
      .join('\n');
    const footer = `BT /F1 8 Tf 56 30 Td (${esc(`${title} - ${p + 1} / ${pages.length}`)}) Tj ET`;
    return `${header}${body}\n${footer}`;
  });

  // 1 catalog, 2 pages, 3 font, 4 bold font, then (page, content) pairs.
  const objects: string[] = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${pages.map((_, i) => `${5 + i * 2} 0 R`).join(' ')}] /Count ${pages.length} >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
  ];
  streams.forEach((s, i) => {
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents ${6 + i * 2} 0 R /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> >>`,
      `<< /Length ${Buffer.byteLength(s, 'latin1')} >>\nstream\n${s}\nendstream`,
    );
  });
  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((o, i) => {
    offsets.push(Buffer.byteLength(body, 'latin1'));
    body += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = Buffer.byteLength(body, 'latin1');
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  body += offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, 'latin1');
}
