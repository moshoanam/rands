// Rands importer: reads .xlsx / .csv / .pdf files entirely on the phone,
// works out what kind of file it is, and turns it into expenses or budgets.
import { unzipSync, strFromU8 } from './fflate.mjs';

// ---------------------------------------------------------------- categories
export const CATS = [
  { id: 'groceries', label: 'Groceries', emoji: '🛒', color: '#22c55e' },
  { id: 'transport', label: 'Transport', emoji: '⛽', color: '#3b82f6' },
  { id: 'eating', label: 'Eating out', emoji: '🍔', color: '#f97316' },
  { id: 'bills', label: 'Bills', emoji: '💡', color: '#eab308' },
  { id: 'family', label: 'Family', emoji: '👨‍👧', color: '#ec4899' },
  { id: 'health', label: 'Health', emoji: '💊', color: '#14b8a6' },
  { id: 'shopping', label: 'Shopping', emoji: '🛍️', color: '#a855f7' },
  { id: 'fun', label: 'Fun', emoji: '🎬', color: '#6366f1' },
  { id: 'other', label: 'Other', emoji: '📦', color: '#64748b' },
];

// Category names people use in their own sheets → Rands category
const CAT_SYNONYMS = [
  ['groceries', /grocer|supermarket|food(?!.*(out|takeaway))|household food/i],
  ['transport', /transport|fuel|petrol|diesel|car\b|vehicle|travel|uber|taxi|toll|parking|commut/i],
  ['eating', /eat|restaurant|take ?away|takeout|dining|coffee|lunch|dinner|fast ?food/i],
  ['bills', /bill|utilit|electric|water|rates|rent|bond|mortgage|insurance|phone|cell|airtime|data|internet|wifi|fibre|subscri|levy|levies|debit order|loan|tax/i],
  ['family', /family|kid|child|school|education|creche|daycare|tuition|allowance|pocket money/i],
  ['health', /health|medical|medicine|pharma|doctor|dentist|hospital|gym|fitness|wellness/i],
  ['shopping', /shop|cloth|apparel|fashion|household|home|hardware|electronic|gift/i],
  ['fun', /fun|entertain|leisure|stream|movie|cinema|hobby|holiday|vacation|sport|games?/i],
  ['other', /other|misc|sundr|general/i],
];
export function mapCategoryName(name) {
  if (!name) return null;
  const n = String(name).trim();
  const exact = CATS.find(c => c.label.toLowerCase() === n.toLowerCase() || c.id === n.toLowerCase());
  if (exact) return exact.id;
  for (const [id, re] of CAT_SYNONYMS) if (re.test(n)) return id;
  return null;
}

// South African merchants → category
const MERCHANTS = [
  ['groceries', /woolworths|woolies|checkers|pick ?n ?pay|\bpnp\b|spar\b|shoprite|food ?lover|boxer|ok foods|usave|cambridge food|fruit ?& ?veg|makro food|sixty60/i],
  ['transport', /engen|shell|\bbp\b|sasol|caltex|totalenergies|\btotal\b|astron|uber(?! ?eats)|bolt|gautrain|e-?toll|sanral|parking|car wash|autozone|midas|tyre|dunlop|supa ?quick|aa\b|lift ride|flysafair|airlink|kulula/i],
  ['eating', /nando|kfc|mcdonald|mcd\b|steers|wimpy|spur|uber ?eats|mr ?d\b|mr d food|debonairs|roman'?s|ocean basket|burger king|starbucks|vida e|seattle coffee|mugg|panarottis|fishaways|chicken licken|galito|rocomamas|col'?cacchio|tashas|kauai|pizza|restaurant|cafe|coffee|bistro|grill/i],
  ['bills', /eskom|city of (joburg|johannesburg|tshwane|cape town)|ekurhuleni|municipal|prepaid elec|vodacom|\bmtn\b|telkom|cell ?c|\brain\b|afrihost|vumatel|openserve|webafrica|cool ?ideas|dstv|multichoice|discovery (insure|life)|old mutual|sanlam|outsurance|santam|momentum|liberty|hollard|king price|miway|budget insurance|levy|rates|insurance|premium|bond|home ?loan|vehicle finance|wesbank|sars/i],
  ['health', /clicks|dis-?chem|pharm|medirite|doctor|dr\.? |dental|dentist|optom|spec-?savers|netcare|mediclinic|life health|hospital|pathcare|lancet|ampath|virgin active|planet fitness|discovery health|medical aid|bonitas|gems\b/i],
  ['family', /school|college|creche|daycare|tuition|toys ?r ?us|toy kingdom|baby city|kids|cotton on kids|uniform|scholar|edu/i],
  ['shopping', /takealot|mr ?price|edgars|truworths|foschini|tfg|superbalist|zando|game\b|makro|builders|leroy merlin|cashbuild|incredible|hifi corp|ackermans|pep\b|jet\b|h&m|zara|cotton on|sportscene|totalsports|identity|amazon|shein|temu|bash\b|cna\b|exclusive books|@home|mr price home|clicks home|loot/i],
  ['fun', /netflix|showmax|spotify|apple\.com|itunes|google play|youtube|disney|prime video|ster-?kinekor|nu ?metro|computicket|ticketpro|quicket|playstation|xbox|steam|lotto|bet|casino|hollywoodbets|supabets/i],
];
export function merchantKey(desc) {
  return String(desc || '').toUpperCase()
    .replace(/\b(POS|CARD|PURCHASE|PURCH|DEBIT ORDER|DEBIT|PAYMENT|PMT|TRANSFER|ELECTRONIC|ONLINE|CONTACTLESS|TAP|ACB|IB|APP|PAYSHAP|FROM|TO)\b/g, ' ')
    .replace(/\d+[\d*\/.\-:]*/g, ' ').replace(/[^A-Z&' ]/g, ' ').replace(/\s+/g, ' ').trim()
    .split(' ').slice(0, 3).join(' ');
}
export function categorise(desc, rules = {}, srcCategory = null) {
  const key = merchantKey(desc);
  if (key && rules[key]) return rules[key];
  const fromSrc = mapCategoryName(srcCategory);
  if (fromSrc) return fromSrc;
  for (const [id, re] of MERCHANTS) if (re.test(desc || '')) return id;
  return 'other';
}

// ---------------------------------------------------------------- value parsing
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
const pad = n => String(n).padStart(2, '0');
const isoOf = (y, m, d) => (m >= 1 && m <= 12 && d >= 1 && d <= 31 && y > 1990 && y < 2100) ? `${y}-${pad(m)}-${pad(d)}` : null;

// Returns ISO date string or null. yearHint used when the date has no year.
export function parseDate(v, { serial = false, yearHint } = {}) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') {
    if (serial && v > 20000 && v < 80000) { // Excel serial date
      const d = new Date(Math.round((v - 25569) * 86400e3));
      return isoOf(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
    }
    if (v >= 19900101 && v <= 20991231) v = String(v); else return null;
  }
  const s = String(v).trim();
  let m;
  if ((m = s.match(/^(\d{4})(\d{2})(\d{2})$/))) return isoOf(+m[1], +m[2], +m[3]);
  if ((m = s.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})/))) return isoOf(+m[1], +m[2], +m[3]);
  if ((m = s.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{2,4})\b/))) { // SA: day first
    let y = +m[3]; if (y < 100) y += 2000; return isoOf(y, +m[2], +m[1]);
  }
  if ((m = s.match(/^(\d{1,2})[\s\-\/.]*([A-Za-z]{3,9})\.?[\s\-\/.,]*(\d{2,4})?\b/))) {
    const mo = MONTHS[m[2].toLowerCase().slice(0, 4)] || MONTHS[m[2].toLowerCase().slice(0, 3)];
    if (!mo) return null;
    let y = m[3] ? +m[3] : (yearHint || new Date().getFullYear()); if (y < 100) y += 2000;
    return isoOf(y, mo, +m[1]);
  }
  if ((m = s.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})/))) {
    const mo = MONTHS[m[1].toLowerCase().slice(0, 3)]; return mo ? isoOf(+m[3], mo, +m[2]) : null;
  }
  return null;
}

// Returns { cents (signed), marker: 'dr'|'cr'|null } or null
export function parseAmount(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return isFinite(v) ? { cents: Math.round(v * 100), marker: null } : null;
  let s = String(v).trim();
  let marker = null, neg = false;
  if (/\bcr\.?$/i.test(s)) { marker = 'cr'; s = s.replace(/\s*cr\.?$/i, ''); }
  else if (/\bdr\.?$/i.test(s)) { marker = 'dr'; s = s.replace(/\s*dr\.?$/i, ''); }
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  s = s.replace(/^(R|ZAR)\s*/i, '').replace(/\s*(R|ZAR)$/i, '');
  if (/^-/.test(s)) { neg = !neg; s = s.slice(1); }
  if (/-$/.test(s)) { neg = !neg; s = s.slice(0, -1); }
  s = s.replace(/^(R|ZAR)\s*/i, '').replace(/[\s ']/g, '');
  if (!/^[\d.,]+$/.test(s) || !/\d/.test(s)) return null;
  const lastDot = s.lastIndexOf('.'), lastComma = s.lastIndexOf(',');
  if (lastDot >= 0 && lastComma >= 0) {
    const decSep = lastDot > lastComma ? '.' : ',';
    s = s.split(decSep === '.' ? ',' : '.').join('').replace(',', '.');
  } else if (lastComma >= 0) {
    s = /,\d{1,2}$/.test(s) && (s.match(/,/g) || []).length === 1 ? s.replace(',', '.') : s.replace(/,/g, '');
  } else if ((s.match(/\./g) || []).length > 1) {
    s = s.replace(/\.(?=.*\.)/g, '');
  }
  const n = parseFloat(s); if (!isFinite(n)) return null;
  return { cents: Math.round(n * 100) * (neg ? -1 : 1), marker };
}

// ---------------------------------------------------------------- file readers
function colIndex(ref) { let n = 0; for (const ch of ref.replace(/\d+/g, '')) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1; }

function readXlsx(buf) {
  let files;
  try { files = unzipSync(new Uint8Array(buf)); } catch { throw new Error('This doesn’t look like a valid .xlsx file.'); }
  const xml = p => files[p] ? new DOMParser().parseFromString(strFromU8(files[p]), 'application/xml') : null;
  const tagAll = (doc, name) => Array.from(doc.getElementsByTagNameNS('*', name));
  const shared = [];
  const ss = xml('xl/sharedStrings.xml');
  if (ss) for (const si of tagAll(ss, 'si')) shared.push(tagAll(si, 't').map(t => t.textContent).join(''));

  // which number formats are dates?
  const dateStyles = new Set();
  const st = xml('xl/styles.xml');
  if (st) {
    const custom = {};
    for (const nf of tagAll(st, 'numFmt')) custom[nf.getAttribute('numFmtId')] = nf.getAttribute('formatCode') || '';
    const cellXfs = tagAll(st, 'cellXfs')[0];
    if (cellXfs) Array.from(cellXfs.children).forEach((xf, i) => {
      const id = +xf.getAttribute('numFmtId');
      const code = custom[id] || '';
      if ((id >= 14 && id <= 22) || (id >= 45 && id <= 47) || (/[dy]/i.test(code.replace(/\[[^\]]*\]|"[^"]*"/g, '')) && !/^general$/i.test(code))) dateStyles.add(i);
    });
  }

  const wb = xml('xl/workbook.xml'), rels = xml('xl/_rels/workbook.xml.rels');
  const relMap = {};
  if (rels) for (const r of tagAll(rels, 'Relationship')) relMap[r.getAttribute('Id')] = r.getAttribute('Target');
  const sheets = [];
  for (const s of wb ? tagAll(wb, 'sheet') : []) {
    const rid = s.getAttribute('r:id') || s.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
    let target = relMap[rid] || ''; target = target.replace(/^\/?xl\//, '').replace(/^\//, '');
    const doc = xml('xl/' + target); if (!doc) continue;
    const rows = [];
    for (const row of tagAll(doc, 'row')) {
      const r = +row.getAttribute('r') - 1; const out = [];
      for (const c of tagAll(row, 'c')) {
        const ref = c.getAttribute('r'); const ci = ref ? colIndex(ref) : out.length;
        const t = c.getAttribute('t'); const vEl = tagAll(c, 'v')[0]; const v = vEl ? vEl.textContent : null;
        let val = null;
        if (t === 's') val = shared[+v] ?? '';
        else if (t === 'inlineStr') val = tagAll(c, 't').map(x => x.textContent).join('');
        else if (t === 'str' || t === 'e') val = v;
        else if (t === 'b') val = v === '1';
        else if (v != null) {
          val = +v;
          if (dateStyles.has(+c.getAttribute('s'))) val = { serialDate: val };
        }
        out[ci] = val;
      }
      rows[isNaN(r) ? rows.length : r] = out;
    }
    sheets.push({ name: s.getAttribute('name') || 'Sheet', rows: Array.from(rows, r => r || []) });
  }
  return sheets;
}

function readCsv(text) {
  text = text.replace(/^﻿/, '');
  const sample = text.split(/\r?\n/).slice(0, 15).join('\n');
  const delim = [',', ';', '\t', '|'].map(d => [d, (sample.match(new RegExp(d === '|' ? '\\|' : d, 'g')) || []).length]).sort((a, b) => b[1] - a[1])[0][0];
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; }
    else if (ch === '"') q = true;
    else if (ch === delim) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return [{ name: 'CSV', rows: rows.map(r => r.map(c => c.trim())) }];
}

async function readPdf(buf, askPassword) {
  const pdfjs = await import('./pdf.min.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('./pdf.worker.min.mjs', import.meta.url).href;
  let password;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const doc = await pdfjs.getDocument({ data: new Uint8Array(buf.slice(0)), password, isEvalSupported: false, disableFontFace: true, useSystemFonts: false }).promise;
      const lines = [];
      for (let p = 1; p <= doc.numPages; p++) {
        const page = await doc.getPage(p);
        const tc = await page.getTextContent();
        const items = tc.items.filter(it => it.str && it.str.trim()).map(it => ({ s: it.str, x: it.transform[4], y: it.transform[5], w: it.width }));
        items.sort((a, b) => b.y - a.y || a.x - b.x);
        let cur = null;
        for (const it of items) {
          if (!cur || Math.abs(cur.y - it.y) > 3) { cur = { y: it.y, cells: [] }; lines.push(cur); }
          cur.cells.push(it);
        }
        lines.forEach(l => l.cells.sort((a, b) => a.x - b.x));
      }
      await doc.destroy();
      // Merge cells that are touching into tokens, keep big gaps as column breaks
      return lines.map(l => {
        const cells = []; let prev = null;
        for (const c of l.cells) {
          if (prev && c.x - (prev.x + prev.w) < 4) { prev.s += (c.x - (prev.x + prev.w) > 1 ? ' ' : '') + c.s; prev.w = c.x + c.w - prev.x; }
          else { prev = { ...c }; cells.push(prev); }
        }
        return cells.map(c => c.s.trim()).filter(Boolean);
      });
    } catch (e) {
      if (e && e.name === 'PasswordException') {
        password = await askPassword(attempt > 0);
        if (password == null) throw new Error('This PDF is password-protected.');
        continue;
      }
      throw new Error('Couldn’t read this PDF' + (e && e.message ? ': ' + e.message : '.'));
    }
  }
  throw new Error('Wrong PDF password.');
}

// ---------------------------------------------------------------- detection
const HEAD = {
  date: /^(transaction |trans\.? |posting |post |value |txn |process(ed)? )?date$|^date|date$/i,
  desc: /desc|detail|narrat|particular|reference|merchant|payee|transaction$|item|^name$|^expense$|what|memo|note|beneficiary|^category$/i,
  amount: /^amount|amount$|^value$|^amt|zar|rand|^cost|^price|^spent|^total$/i,
  debit: /debit|withdraw|money out|^out$|paid out|payments?$|spent/i,
  credit: /credit|deposit|money in|^in$|paid in|receipts?$/i,
  balance: /balance|^bal/i,
  category: /categor|^type$|^group$|^class|^bucket/i,
  budget: /budget|limit|allocat|planned|target|monthly|allowance/i,
};

function cellText(v) { return v && typeof v === 'object' && 'serialDate' in v ? String(v.serialDate) : (v == null ? '' : String(v)); }

function detectHeader(rows) {
  let best = { idx: -1, score: 0 };
  for (let i = 0; i < Math.min(rows.length, 30); i++) {
    const r = rows[i] || []; let score = 0;
    for (const c of r) {
      const t = cellText(c).trim(); if (!t || t.length > 40 || parseAmount(t) || parseDate(t)) continue;
      for (const re of Object.values(HEAD)) if (re.test(t)) { score++; break; }
    }
    if (score > best.score) best = { idx: i, score };
  }
  return best.score >= 2 ? best.idx : -1;
}

function guessColumns(rows, headerIdx) {
  const header = headerIdx >= 0 ? rows[headerIdx].map(cellText) : [];
  const data = rows.slice(headerIdx + 1).filter(r => r && r.some(c => cellText(c).trim()));
  const width = Math.max(0, ...rows.map(r => (r || []).length));
  const sample = data.slice(0, 200);
  const stats = Array.from({ length: width }, (_, j) => {
    let dates = 0, nums = 0, text = 0, len = 0, filled = 0;
    for (const r of sample) {
      const v = r[j]; if (v == null || cellText(v).trim() === '') continue; filled++;
      if ((v && v.serialDate != null) || (typeof v !== 'number' && parseDate(v))) dates++;
      else if (parseAmount(v)) nums++;
      else { text++; len += cellText(v).length; }
    }
    return { dates, nums, text, filled, avg: text ? len / text : 0 };
  });
  const numeric = j => stats[j].nums > 0 && stats[j].nums >= stats[j].text;
  const texty = j => stats[j].text > 0 && stats[j].text >= stats[j].nums;
  const datey = j => stats[j].dates > 0 && stats[j].dates >= (stats[j].filled * 0.5);
  const map = {};
  const used = () => new Set(Object.values(map));
  const take = (role, re, ok, exclude = []) => {
    if (map[role] != null) return;
    const i = header.findIndex((h, j) => h && re.test(h.trim()) && !used().has(j) && !exclude.some(x => x.test(h)) && (!sample.length || ok(j)));
    if (i >= 0) map[role] = i;
  };
  take('date', HEAD.date, datey);
  take('balance', HEAD.balance, numeric);
  take('budget', HEAD.budget, numeric, [HEAD.date]);
  take('debit', HEAD.debit, numeric, [HEAD.date]);
  take('credit', HEAD.credit, numeric, [HEAD.date]);
  take('amount', HEAD.amount, numeric, [HEAD.balance]);
  take('category', HEAD.category, texty);
  take('desc', HEAD.desc, texty, [HEAD.date]);

  // content-based fallbacks
  if (map.date == null) { const j = stats.map((st, i) => [st.dates, i]).filter(([d, i]) => d > sample.length * 0.5 && !used().has(i)).sort((a, b) => b[0] - a[0])[0]; if (j) map.date = j[1]; }
  if (map.desc == null) { const j = stats.map((st, i) => [st.text * st.avg, i]).filter(([v, i]) => v > 0 && !used().has(i)).sort((a, b) => b[0] - a[0])[0]; if (j) map.desc = j[1]; }
  if (map.amount == null && map.debit == null && map.credit == null && map.budget == null) {
    const j = stats.map((st, i) => [st.nums, i]).filter(([n, i]) => n > sample.length * 0.5 && !used().has(i)).sort((a, b) => a[1] - b[1])[0];
    if (j) map.amount = j[1];
  }
  return { map, header, width };
}

function yearHintFrom(rows) {
  const counts = {};
  for (const r of rows.slice(0, 400)) for (const c of r || []) { const m = cellText(c).match(/\b(20\d{2})\b/); if (m) counts[m[1]] = (counts[m[1]] || 0) + 1; }
  const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  return best ? +best[0] : new Date().getFullYear();
}

function fixFutureYear(iso, hadYear) {
  if (!iso || hadYear) return iso;
  const today = new Date(); const d = new Date(iso);
  if (d - today > 2 * 86400e3) return (d.getFullYear() - 1) + iso.slice(4);
  return iso;
}

export function analyseTable(sheet, overrides) {
  const rows = sheet.rows;
  const headerIdx = overrides && 'headerIdx' in overrides ? overrides.headerIdx : detectHeader(rows);
  const g = guessColumns(rows, headerIdx);
  const map = overrides && overrides.map ? { ...overrides.map } : g.map;
  const dataRows = rows.slice(headerIdx + 1);
  const yearHint = yearHintFrom(rows);

  // Budget sheet: categories + amounts, no dates
  const hasDates = map.date != null && dataRows.filter(r => r && parseDate(r[map.date] && r[map.date].serialDate != null ? r[map.date].serialDate : r[map.date], { serial: true, yearHint })).length >= 2;
  const budgetCol = map.budget ?? map.amount ?? map.debit;
  const labelCol = map.category ?? map.desc;
  if (!hasDates && budgetCol != null && labelCol != null) {
    const items = [];
    for (const r of dataRows) {
      if (!r) continue;
      const label = cellText(r[labelCol]).trim(); const a = parseAmount(r[budgetCol]);
      if (!label || !a || !a.cents || /^(total|grand total|sum|income|salary|net)/i.test(label)) continue;
      items.push({ label, cat: mapCategoryName(label) || categorise(label) || 'other', cents: Math.abs(a.cents) });
    }
    if (items.length) return { kind: 'budget', items, headerIdx, map, header: g.header, width: g.width };
  }

  if (!hasDates || (map.amount == null && map.debit == null && map.credit == null)) {
    return { kind: 'unknown', headerIdx, map, header: g.header, width: g.width };
  }

  const txns = [];
  const typeCol = map.category != null && /^type$/i.test(cellText(g.header[map.category])) ? map.category : null;
  for (const r of dataRows) {
    if (!r) continue;
    const dv = r[map.date]; const raw = dv && dv.serialDate != null ? dv.serialDate : dv;
    const hadYear = /\d{4}|\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2}/.test(cellText(raw)) || typeof raw === 'number';
    const date = fixFutureYear(parseDate(raw, { serial: true, yearHint }), hadYear);
    if (!date) continue;
    const desc = map.desc != null ? cellText(r[map.desc]).replace(/\s+/g, ' ').trim() : '';
    if (/^(opening|closing|balance brought|balance carried|brought forward|carried forward)/i.test(desc)) continue;
    let cents = null, credit = false;
    if (map.debit != null || map.credit != null) {
      const d = map.debit != null ? parseAmount(r[map.debit]) : null;
      const c = map.credit != null ? parseAmount(r[map.credit]) : null;
      if (d && d.cents) { cents = Math.abs(d.cents); credit = false; }
      else if (c && c.cents) { cents = Math.abs(c.cents); credit = true; }
    } else {
      const a = parseAmount(r[map.amount]);
      if (a && a.cents) {
        cents = a.cents;
        if (a.marker === 'cr') { credit = true; cents = Math.abs(cents); }
        else if (a.marker === 'dr') cents = -Math.abs(cents);
      }
    }
    if (cents == null || cents === 0) continue;
    const typeText = typeCol != null ? cellText(r[typeCol]) : '';
    txns.push({ date, desc, cents, credit, typeText, srcCategory: map.category != null && typeCol == null ? cellText(r[map.category]).trim() : '' });
  }
  return { kind: 'transactions', txns: normaliseSigns(txns), headerIdx, map, header: g.header, width: g.width };
}

// Decide which rows are money out (expenses) vs money in.
function normaliseSigns(txns) {
  const signed = txns.filter(t => !t.credit);
  const neg = signed.filter(t => t.cents < 0).length, pos = signed.filter(t => t.cents > 0).length;
  for (const t of txns) {
    if (/credit|deposit|refund/i.test(t.typeText)) t.credit = true;
    else if (/debit|withdraw|purchase|payment/i.test(t.typeText)) t.credit = false;
    else if (!t.credit && neg > 0 && pos > 0) t.credit = t.cents > 0;   // bank style: negative = out
    t.cents = Math.abs(t.cents);
    if (!t.credit && /salary|refund|reversal|interest received|deposit|cash ?send received/i.test(t.desc)) t.credit = true;
  }
  return txns;
}

// PDF statements: each line → date, description, amounts
const AMT_TOKEN = /^\(?-?(R\s?)?-?\d{1,3}([ , ]?\d{3})*([.,]\d{2})\)?-?(\s?(Cr|Dr|CR|DR))?$/;
export function analysePdfLines(lines) {
  const yearHint = yearHintFrom(lines);
  const rows = [];
  for (const cells of lines) {
    // split cells further into tokens that may hold amounts
    const toks = [];
    for (const c of cells) {
      if (AMT_TOKEN.test(c)) { toks.push(c); continue; }
      const m = c.match(/^(.*?)\s+(\(?-?(?:R\s?)?\d[\d , ]*[.,]\d{2}\)?-?(?:\s?(?:Cr|Dr|CR|DR))?)$/);
      if (m && AMT_TOKEN.test(m[2])) { toks.push(m[1], m[2]); } else toks.push(c);
    }
    // the date is made of the first 1–3 tokens that look like date parts
    const datePart = t => /^(\d{1,4}|[A-Za-z]{3,9}\.?|\d{1,4}[\s\-\/.][\dA-Za-z\s\-\/.]{1,12})$/.test(t) && !AMT_TOKEN.test(t);
    let used = 0; while (used < 3 && used < toks.length && datePart(toks[used])) used++;
    let date = null, start = '';
    for (let n = used; n >= 1 && !date; n--) {
      const s = toks.slice(0, n).join(' ');
      const d = parseDate(s, { yearHint });
      if (d && /^\d{1,4}[\s\-\/.]*([A-Za-z]{3,9}|\d{1,2})/.test(s)) { date = d; used = n; start = s; }
    }
    if (!date) continue;
    const rest = toks.slice(used);
    // the date token may contain more than the date
    const amts = []; const descParts = [];
    for (const t of rest) { if (AMT_TOKEN.test(t)) amts.push(parseAmount(t)); else if (!amts.length) descParts.push(t); }
    if (!amts.length) continue;
    let desc = descParts.join(' ').replace(/\s+/g, ' ').trim();
    const leftover = start.replace(/^\s*\d{1,2}[\s\-\/.]*[A-Za-z0-9]{2,9}[\s\-\/.]*(\d{2,4})?\s*/, '');
    if (leftover && !/^\d+$/.test(leftover)) desc = (leftover + ' ' + desc).trim();
    if (/^(opening|closing|balance|brought forward|carried forward|total)/i.test(desc)) continue;
    const hadYear = /\d{4}|\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2}/.test(start);
    rows.push({ date: fixFutureYear(date, hadYear), desc, amts });
  }
  if (!rows.length) return { kind: 'unknown' };

  // Work out direction. Best signal: how the running balance moves.
  const anyMinus = rows.some(r => r.amts.some(a => a.cents < 0));
  const anyCr = rows.some(r => r.amts.some(a => a.marker === 'cr'));
  const txns = [];
  let prevBal = null;
  for (const r of rows) {
    const amt = r.amts[0];
    const bal = r.amts.length >= 2 ? r.amts[r.amts.length - 1] : null;
    let credit;
    if (bal && prevBal != null) {
      const balSigned = bal.marker === 'dr' ? -Math.abs(bal.cents) : bal.cents;
      const delta = balSigned - prevBal;
      if (Math.abs(Math.abs(delta) - Math.abs(amt.cents)) <= 1) credit = delta > 0;
    }
    if (credit === undefined) {
      if (amt.marker === 'cr') credit = true;
      else if (amt.marker === 'dr') credit = false;
      else if (anyMinus) credit = amt.cents > 0;
      else if (anyCr) credit = false;
      else credit = false;
    }
    if (bal) prevBal = bal.marker === 'dr' ? -Math.abs(bal.cents) : bal.cents;
    if (!amt.cents) continue;
    txns.push({ date: r.date, desc: r.desc, cents: Math.abs(amt.cents), credit, srcCategory: '' });
  }
  for (const t of txns) if (!t.credit && /salary|refund|reversal|interest received|deposit/i.test(t.desc)) t.credit = true;
  return { kind: 'transactions', txns };
}

// ---------------------------------------------------------------- public entry
export async function readFile(file, askPassword) {
  const name = file.name.toLowerCase();
  const buf = await file.arrayBuffer();
  const head = new Uint8Array(buf.slice(0, 8));
  const isZip = head[0] === 0x50 && head[1] === 0x4b;
  const isPdf = head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46;
  const isOle = head[0] === 0xd0 && head[1] === 0xcf;
  if (isPdf || name.endsWith('.pdf')) return { source: 'pdf', lines: await readPdf(buf, askPassword) };
  if (isOle || name.endsWith('.xls')) throw new Error('Old .xls files aren’t supported. Open it in Excel/Numbers and save as .xlsx or .csv.');
  if (isZip || name.endsWith('.xlsx') || name.endsWith('.xlsm')) return { source: 'xlsx', sheets: readXlsx(buf) };
  return { source: 'csv', sheets: readCsv(new TextDecoder('utf-8').decode(buf)) };
}

// Analyse every sheet; return results ranked by usefulness.
export function analyse(read) {
  if (read.source === 'pdf') return [{ name: 'PDF statement', source: 'pdf', ...analysePdfLines(read.lines) }];
  const out = read.sheets.map(s => ({ name: s.name, source: read.source, sheet: s, ...analyseTable(s) }));
  const rank = r => r.kind === 'transactions' ? 2 + r.txns.length / 1e4 : r.kind === 'budget' ? 1 : 0;
  return out.sort((a, b) => rank(b) - rank(a));
}

// Mark likely duplicates of what's already stored.
export function markDuplicates(txns, existing) {
  const norm = s => merchantKey(s);
  const index = new Map();
  for (const e of existing) { const k = e.date + '|' + e.amount; (index.get(k) || index.set(k, []).get(k)).push(norm(e.note)); }
  for (const t of txns) {
    const hits = index.get(t.date + '|' + t.cents);
    t.dup = !!(hits && hits.some(n => !n || !norm(t.desc) || n === norm(t.desc) || n.startsWith(norm(t.desc)) || norm(t.desc).startsWith(n)));
  }
  return txns;
}
