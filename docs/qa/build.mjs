import ExcelJS from 'exceljs';
import { modules } from './cases.mjs';

const out = process.argv[2];
const wb = new ExcelJS.Workbook();
wb.creator = 'ParkShield';
wb.created = new Date('2026-11-26');

const BLUE = 'FF1D4ED8', LIGHT = 'FFE8EEFB', GREY = 'FFF3F4F6';
const head = (row) => row.eachCell((c) => {
  c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BLUE } };
  c.alignment = { vertical: 'middle', wrapText: true };
});

// ---------- Read me ----------
const rm = wb.addWorksheet('Read me', { properties: { tabColor: { argb: BLUE } } });
rm.columns = [{ width: 30 }, { width: 110 }];
const lines = [
  ['ParkShield — Test cases for external QA', ''],
  ['Version / date', '1.0 — 2026-11-26'],
  ['WHERE ARE THE CASES?', 'All 213 test cases are in the sheet „Test cases“ (tabs at the bottom of the window). Overview per module: sheet „Summary“. Defect log: sheet „Defects“.'],
  ['Product', 'QR decal for cars. A stranger scans the decal, picks a problem on a web page (no app, no account) and the owner gets an app push, a reminder push after 10 min and one SMS after 30 min. Owner phone number, name and plate are never shown to the scanner. One plan „ParkShield“, 19,99 € / year incl. 19 % VAT, one vehicle.'],
  ['In scope', '1) Public website  2) Scanner page /s/<code> and view page /v/<token>  3) Mobile app iOS + Android (sign-up, payment, vehicles, decals, alerts, chat, account)  4) E-mails and SMS  5) Back office (ops app, staff only)  6) Security, accessibility, performance, compatibility.'],
  ['Out of scope', 'Real money (Stripe is in TEST mode). Load / stress tests and intrusive security tests (scanning, fuzzing, brute force) ONLY in a time window agreed in writing with the owner. No social engineering. No tests against Stripe, Twilio, Mailjet, Google or Apple infrastructure itself.'],
  ['', ''],
  ['ENVIRONMENT', ''],
  ['Website + scanner', 'https://test.park-shield.de (basic auth — credentials are sent separately, never in this file)'],
  ['Back office', 'https://ops.test.park-shield.de (basic auth + personal staff passkey; each tester gets an own invite)'],
  ['Mobile app', 'iOS: TestFlight build. Android: APK / internal testing track. Links are sent separately. Push, Face ID and the return from the Stripe page only work in these builds (not in Expo Go).'],
  ['UI language', 'German is the source language, English the second. Button names are quoted in German („…“) as they appear in the UI.'],
  ['', ''],
  ['TEST DATA', ''],
  ['Accounts', 'Create your own accounts with your own e-mail addresses and mobile numbers (e-mails and SMS are REAL). Use plus-addressing (name+a1@company.com) for several accounts. Suggested: A1 main paid owner with vehicle; A2 for cancellation; A3 for withdrawal (< 14 days); A4 for account deletion; B second owner for authorisation tests.'],
  ['Stripe test cards', 'Success 4242 4242 4242 4242 · Declined 4000 0000 0000 0002 · 3-D Secure 4000 0027 6000 3184 · Second card 5555 5555 5555 4444 · Fails on renewal 4000 0000 0000 0341. Any future expiry date, any CVC, any name.'],
  ['Phone numbers', 'Owner number must be a mobile number that can receive SMS (DE 015x–017x or another allowed EU country). Landline and VoIP numbers are rejected on purpose.'],
  ['', ''],
  ['EXPECTED ON THE TEST SERVER (not bugs)', ''],
  ['Captcha', 'Simulated („Sicherheitsprüfung: lokal simuliert“).'],
  ['Wait between alerts', '1 minute per vehicle (production: 15 minutes).'],
  ['Alert photos', 'Switched on (production: later).'],
  ['Printed decals', 'No print partner yet: orders are files on the server; staff mark them as shipped.'],
  ['Store purchases', 'Google Play: works on the internal-test track for Google accounts on our tester list (send us the testers\' Google accounts). App Store: TestFlight with sandbox Apple IDs. Test subscriptions renew fast (Play: every 30 min, Apple sandbox: every hour) and stop after a few renewals — expected. If a store is not available to you, mark those cases „Blocked“.'],
  ['Search engines', 'Pages carry noindex until go-live.'],
  ['', ''],
  ['HOW TO USE THE „Test cases“ SHEET', ''],
  ['Columns', 'Fill Status (dropdown), Actual result, Tester, Date, Build / browser, Defect ID. Do not change the ID column.'],
  ['Status', 'Not run · Pass · Fail · Blocked · N/A'],
  ['Priority', 'P1 critical (core flow, money, privacy, security) · P2 high · P3 medium · P4 low'],
  ['Type', 'Positive (happy path) · Negative (invalid input, refusals) · Edge (limits, timing, races) · Security · Accessibility · Performance · Compatibility · Reliability · Usability'],
  ['„Known finding“', 'Some cases name a finding already known from our own QA (2026-11-25). Please confirm whether it still happens.'],
  ['Exploratory testing', 'Please add your own cases at the end of the sheet (ID prefix EXP-) — we expect exploratory testing beyond this list.'],
  ['', ''],
  ['REPORTING DEFECTS', ''],
  ['Where', 'Sheet „Defects“ (or your own tracker, then put the ID in the Defect ID column).'],
  ['What', 'Steps to reproduce, expected vs. actual, URL WITHOUT codes / tokens / #t= links, time (with time zone), device, OS, browser / app build, screenshot or video.'],
  ['Privacy', 'Never put real personal data, decal codes, sign-in links, view links or passwords into screenshots, tickets or e-mails. Blur them.'],
  ['Severity', 'Blocker (no workaround, core flow / money / data leak) · Critical · Major · Minor · Trivial'],
  ['After the test', 'Delete test accounts you no longer need (in the app: Konto → Daten → Konto löschen) and tell us which back-office settings you changed.'],
];
lines.forEach(([a, b], i) => {
  const r = rm.addRow([a, b]);
  r.getCell(2).alignment = { wrapText: true, vertical: 'top' };
  r.getCell(1).alignment = { vertical: 'top', wrapText: true };
  if (i === 0) { r.getCell(1).font = { bold: true, size: 16, color: { argb: BLUE } }; rm.mergeCells(r.number, 1, r.number, 2); r.height = 26; }
  else if (a === 'WHERE ARE THE CASES?') { r.eachCell((c) => { c.font = { bold: true }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFDE68A' } }; }); }
  else if (a && !b) { r.getCell(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }; r.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BLUE } }; rm.mergeCells(r.number, 1, r.number, 2); }
  else if (a) { r.getCell(1).font = { bold: true }; }
});

// ---------- Test cases ----------
const ws = wb.addWorksheet('Test cases', { views: [{ state: 'frozen', xSplit: 2, ySplit: 1 }], properties: { tabColor: { argb: 'FF16A34A' } } });
const cols = [
  ['ID', 11], ['Title', 40], ['Module', 22], ['Feature', 18], ['Type', 13], ['Priority', 9], ['Platform', 16],
  ['Preconditions', 28], ['Steps', 50], ['Test data', 22], ['Expected result', 55], ['Ref', 14],
  ['Status', 11], ['Actual result', 40], ['Tester', 12], ['Date', 11], ['Build / browser', 16], ['Defect ID', 11],
];
ws.columns = cols.map(([header, width]) => ({ header, width }));
head(ws.getRow(1));
ws.getRow(1).height = 22;
let n = 0;
const moduleNames = [];
for (const [code, name, cases] of modules) {
  moduleNames.push(name);
  cases.forEach((c, i) => {
    const [feature, title, type, prio, platform, pre, steps, data, expected, ref] = c;
    const id = `${code}-${String(i + 1).padStart(3, '0')}`;
    const r = ws.addRow([id, title, name, feature, type, prio, platform, pre, steps, data, expected, ref, 'Not run', '', '', '', '', '']);
    r.alignment = { wrapText: true, vertical: 'top' };
    if (n % 2) r.eachCell({ includeEmpty: true }, (cell) => { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GREY } }; });
    r.getCell(1).font = { bold: true };
    n++;
  });
}
const last = n + 1;
ws.autoFilter = { from: 'A1', to: `R${last}` };
for (let r = 2; r <= last + 200; r++) {
  ws.getCell(`M${r}`).dataValidation = { type: 'list', allowBlank: true, formulae: ['"Not run,Pass,Fail,Blocked,N/A"'] };
  ws.getCell(`P${r}`).numFmt = 'yyyy-mm-dd';
}
const cf = (text, color) => ({ type: 'containsText', operator: 'containsText', text, style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: color } }, font: { bold: true } }, priority: 1 });
ws.addConditionalFormatting({ ref: `M2:M${last + 200}`, rules: [cf('Pass', 'FFBBF7D0'), cf('Fail', 'FFFECACA'), cf('Blocked', 'FFFDE68A'), cf('N/A', 'FFE5E7EB')] });
ws.addConditionalFormatting({ ref: `F2:F${last}`, rules: [cf('P1', 'FFFECACA'), cf('P2', 'FFFED7AA')] });

// ---------- Summary ----------
const sm = wb.addWorksheet('Summary', { properties: { tabColor: { argb: 'FFF59E0B' } } });
sm.columns = [{ width: 46 }, { width: 9 }, { width: 9 }, { width: 9 }, { width: 9 }, { width: 9 }, { width: 9 }, { width: 11 }, { width: 10 }];
head(sm.addRow(['Module', 'Total', 'P1', 'Pass', 'Fail', 'Blocked', 'N/A', 'Not run', 'Done %']));
const R = `'Test cases'!`;
moduleNames.forEach((m) => {
  const row = sm.rowCount + 1;
  const q = `A${row}`;
  sm.addRow([
    m,
    { formula: `COUNTIF(${R}$C:$C,${q})` },
    { formula: `COUNTIFS(${R}$C:$C,${q},${R}$F:$F,"P1")` },
    { formula: `COUNTIFS(${R}$C:$C,${q},${R}$M:$M,"Pass")` },
    { formula: `COUNTIFS(${R}$C:$C,${q},${R}$M:$M,"Fail")` },
    { formula: `COUNTIFS(${R}$C:$C,${q},${R}$M:$M,"Blocked")` },
    { formula: `COUNTIFS(${R}$C:$C,${q},${R}$M:$M,"N/A")` },
    { formula: `COUNTIFS(${R}$C:$C,${q},${R}$M:$M,"Not run")` },
    { formula: `IF(B${row}=0,0,(B${row}-H${row})/B${row})` },
  ]);
});
const end = sm.rowCount;
const tot = sm.addRow(['TOTAL', ...['B', 'C', 'D', 'E', 'F', 'G', 'H'].map((c) => ({ formula: `SUM(${c}2:${c}${end})` })), { formula: `IF(B${end + 1}=0,0,(B${end + 1}-H${end + 1})/B${end + 1})` }]);
tot.font = { bold: true };
tot.eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: LIGHT } }; });
for (let r = 2; r <= end + 1; r++) sm.getCell(`I${r}`).numFmt = '0%';
sm.addRow([]);
head(sm.addRow(['By type', 'Total', 'Pass', 'Fail']));
for (const t of ['Positive', 'Negative', 'Edge', 'Security', 'Accessibility', 'Performance', 'Compatibility', 'Reliability', 'Usability']) {
  const row = sm.rowCount + 1;
  sm.addRow([t, { formula: `COUNTIF(${R}$E:$E,A${row})` }, { formula: `COUNTIFS(${R}$E:$E,A${row},${R}$M:$M,"Pass")` }, { formula: `COUNTIFS(${R}$E:$E,A${row},${R}$M:$M,"Fail")` }]);
}

// ---------- Devices ----------
const dv = wb.addWorksheet('Devices', { properties: { tabColor: { argb: 'FF7C3AED' } } });
dv.columns = [{ header: 'Platform', width: 14 }, { header: 'Device', width: 30 }, { header: 'OS / browser version', width: 24 }, { header: 'Why', width: 50 }, { header: 'Tested by', width: 14 }, { header: 'Notes', width: 40 }];
head(dv.getRow(1));
[
  ['iOS', 'iPhone 15 / 16 (current)', 'iOS latest', 'Main iOS target, Face ID, Dynamic Island'],
  ['iOS', 'iPhone SE (2nd/3rd gen)', 'iOS latest − 1', 'Small screen, Touch ID'],
  ['iOS', 'iPad (any)', 'iPadOS latest', 'Larger layout, rotation'],
  ['Android', 'Samsung Galaxy A-series', 'Android 14/15, One UI', 'Most common in DE, Samsung nav bar, Samsung Internet'],
  ['Android', 'Google Pixel 8/9', 'Android 15/16', 'Stock Android, notification behaviour'],
  ['Android', 'Low-end device (2–3 GB RAM)', 'Android 11–12', 'Performance, battery saver, older WebView'],
  ['Web (phone)', 'iPhone Safari, Chrome Android, Samsung Internet, Firefox Android', 'Last 2 versions', 'Scanner page (the stranger has no app)'],
  ['Web (phone)', 'In-app browsers', 'WhatsApp, Instagram, Facebook, Telegram', 'Scanner links are often shared in messengers'],
  ['Web (desktop)', 'Chrome, Safari, Firefox, Edge', 'Latest', 'Website, view page, back office'],
].forEach((r) => { const row = dv.addRow(r); row.alignment = { wrapText: true, vertical: 'top' }; });

// ---------- Defects ----------
const df = wb.addWorksheet('Defects', { views: [{ state: 'frozen', ySplit: 1 }], properties: { tabColor: { argb: 'FFDC2626' } } });
df.columns = [
  ['Defect ID', 11], ['Test case ID', 12], ['Title', 40], ['Severity', 11], ['Platform / device', 20], ['Build / browser', 16],
  ['Steps to reproduce', 50], ['Expected', 35], ['Actual', 35], ['Attachment (link)', 22], ['Reported by', 13], ['Date', 11], ['Status', 12],
].map(([header, width]) => ({ header, width }));
head(df.getRow(1));
for (let r = 2; r <= 301; r++) {
  df.getCell(`A${r}`).value = `DEF-${String(r - 1).padStart(3, '0')}`;
  df.getCell(`D${r}`).dataValidation = { type: 'list', allowBlank: true, formulae: ['"Blocker,Critical,Major,Minor,Trivial"'] };
  df.getCell(`M${r}`).dataValidation = { type: 'list', allowBlank: true, formulae: ['"New,Confirmed,Fixed,Retest OK,Retest failed,Won\'t fix"'] };
  df.getRow(r).alignment = { wrapText: true, vertical: 'top' };
}

wb.calcProperties = { fullCalcOnLoad: true };
wb.views = [{ activeTab: 1, firstSheet: 0 }];
await wb.xlsx.writeFile(out);
console.log(`cases: ${n}, modules: ${modules.length}`);
