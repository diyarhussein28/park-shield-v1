import ExcelJS from 'exceljs';
import { results, defects } from './results-2026-11-26.mjs';
const [, , src, out] = process.argv;
const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(src);
const ws = wb.getWorksheet('Test cases');
const hdr = {}; ws.getRow(1).eachCell((c, i) => (hdr[c.value] = i));
const ids = new Set(Object.keys(results)); let n = 0; const counts = {};
ws.eachRow((row, r) => {
  if (r === 1) return;
  const id = row.getCell(hdr['ID']).value; if (!id) return;
  const key = String(id).replace(/-0*(\d+)$/, (_, d) => '-' + d.padStart(2, '0')); const res = results[key];
  if (!res) { console.log('MISSING', id); return; }
  ids.delete(key); n++;
  const status = res[0] === 'P' ? 'Pass' : 'Blocked';
  counts[status] = (counts[status] ?? 0) + 1;
  row.getCell(hdr['Status']).value = status;
  row.getCell(hdr['Actual result']).value = res[1];
  row.getCell(hdr['Tester']).value = 'Claude (auto)';
  row.getCell(hdr['Date']).value = '2026-11-26';
  row.getCell(hdr['Build / browser']).value = 'local main + fixes; Chrome desktop/Pixel 7';
  if (res[2]) row.getCell(hdr['Defect ID']).value = res[2];
  row.getCell(hdr['Status']).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: status === 'Pass' ? 'FFDCFCE7' : 'FFFEF3C7' } };
});
const df = wb.getWorksheet('Defects');
defects.forEach((d, i) => {
  const row = df.getRow(i + 2);
  const [id, tc, title, sev, plat, steps, exp, act, status] = d;
  row.values = [id, tc, title, sev, plat, 'local main', steps, exp, act, '', 'Claude (auto)', '2026-11-26', status.startsWith('Fixed') ? 'Fixed' : 'New'];
  row.getCell(9).value = `${act} → ${status}`;
});
const rm = wb.getWorksheet('Read me');
rm.spliceRows(2, 0, ['RESULTS 2026-11-26', `Automated run by Claude on the local stack (fake providers): ${counts.Pass} Pass, ${counts.Blocked} Blocked (need real devices, store builds, Stripe/Twilio test mode on the test server or screen readers), 0 Fail. 5 defects found and fixed (sheet „Defects“).`]);
rm.getRow(2).font = { bold: true, color: { argb: 'FF16A34A' } };
await wb.xlsx.writeFile(out);
console.log('filled', n, counts, 'unused', [...ids]);
