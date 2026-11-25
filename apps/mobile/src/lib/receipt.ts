import { File } from 'expo-file-system';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';

/**
 * The receipt of a cancellation or withdrawal („Sie können diese Seite speichern oder ausdrucken“,
 * § 312k Abs. 4 BGB): the same lines as on the screen, as a small HTML page for the system print
 * dialog or as a PDF for the share sheet (save to Files, mail). Nothing is sent to the server.
 */
export interface Receipt {
  title: string;
  lines: string[];
}

const escape = (v: string) => v.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

export function receiptHtml({ title, lines }: Receipt): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escape(title)}</title>
<style>body{font-family:-apple-system,Roboto,Helvetica,Arial,sans-serif;color:#111;margin:40px;font-size:14px;line-height:1.5}
h1{font-size:20px;margin:0 0 16px}p{margin:0 0 10px}.brand{font-weight:700;color:#1d4ed8;margin-bottom:24px}</style>
</head><body><div class="brand">ParkShield</div><h1>${escape(title)}</h1>${lines
    .map((l) => `<p>${escape(l)}</p>`)
    .join('')}</body></html>`;
}

/** „Seite drucken“: the system print dialog (AirPrint / Android print service). */
export async function printReceipt(receipt: Receipt): Promise<void> {
  await Print.printAsync({ html: receiptHtml(receipt) });
}

/** „Als PDF sichern“: a temporary PDF in the share sheet, deleted again afterwards. */
export async function shareReceiptPdf(receipt: Receipt): Promise<void> {
  if (!(await Sharing.isAvailableAsync())) throw new Error('sharing_unavailable');
  const { uri } = await Print.printToFileAsync({ html: receiptHtml(receipt) });
  try {
    await Sharing.shareAsync(uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf' });
  } finally {
    const file = new File(uri);
    if (file.exists) file.delete();
  }
}
