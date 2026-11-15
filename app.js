import { vault } from './vault.js';
import { CATS, categorise, merchantKey, readFile, analyse, analyseTable, markDuplicates, mapCategoryName } from './importer.js';

const CAT = Object.fromEntries(CATS.map(c => [c.id, c]));
const $ = id => document.getElementById(id);
const PIN_LEN = 6;

let state = null;          // decrypted data, only while unlocked
let view = new Date(); view.setDate(1);

// ---------------------------------------------------------------- helpers
const fmt = new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR' });
const money = c => fmt.format((c || 0) / 100);
const pad = n => String(n).padStart(2, '0');
const iso = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const ym = d => d.getFullYear() + '-' + pad(d.getMonth() + 1);
const toCents = s => { if (s == null) return NaN; s = String(s).replace(/[\sR]/g, '').replace(',', '.'); if (!/^\d*\.?\d{0,2}$/.test(s) || s === '' || s === '.') return NaN; return Math.round(parseFloat(s) * 100); };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const parseISO = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const shortDate = s => parseISO(s).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: '2-digit' });
function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 2200); }

function defaults(s) {
  s = s || {};
  return { expenses: [], budget: 0, catBudgets: {}, rules: {}, autoLock: 60, lastCat: 'groceries', ...s,
    catBudgets: s.catBudgets || {}, rules: s.rules || {}, expenses: Array.isArray(s.expenses) ? s.expenses : [] };
}

let saving = Promise.resolve();
function persist() {
  const snapshot = state;
  saving = saving.then(() => snapshot && vault.save(snapshot)).catch(() => toast('Couldn’t save — storage full?'));
  return saving;
}

// ---------------------------------------------------------------- dialogs
function dialog({ msg, yes = 'OK', no = 'Cancel', danger = false, input = null, validate = null }) {
  return new Promise(res => {
    const d = $('dlg'), inp = $('dlgInput'), err = $('dlgErr');
    $('dlgMsg').textContent = msg; $('dlgYes').textContent = yes; $('dlgNo').textContent = no;
    $('dlgNo').hidden = no == null;
    $('dlgYes').classList.toggle('red', danger);
    err.textContent = '';
    inp.hidden = !input; inp.value = '';
    if (input) { inp.type = input.type || 'password'; inp.inputMode = input.mode || 'text'; inp.placeholder = input.placeholder || ''; }
    d.classList.add('show');
    if (input) setTimeout(() => inp.focus(), 50);
    const done = v => { d.classList.remove('show'); inp.blur(); $('dlgYes').onclick = $('dlgNo').onclick = inp.onkeydown = null; res(v); };
    $('dlgYes').onclick = async () => {
      if (!input) return done(true);
      if (validate) { const e = await validate(inp.value); if (e) { err.textContent = e; return; } }
      done(inp.value);
    };
    $('dlgNo').onclick = () => done(input ? null : false);
    inp.onkeydown = e => { if (e.key === 'Enter') $('dlgYes').click(); };
  });
}
const ask = (msg, yes = 'OK', danger = true) => dialog({ msg, yes, danger });
const askSecret = (msg, opts = {}) => dialog({ msg, yes: opts.yes || 'Continue', input: { type: 'password', mode: opts.mode || 'text', placeholder: opts.placeholder }, validate: opts.validate });

// ---------------------------------------------------------------- lock screen
let pinBuf = '', lockMode = 'unlock', firstPin = '', busy = false, throttleTimer = null;

function drawDots() { $('dots').innerHTML = Array.from({ length: PIN_LEN }, (_, i) => `<i class="${i < pinBuf.length ? 'on' : ''}"></i>`).join(''); }
function drawKeypad() {
  const bio = lockMode === 'unlock' && vault.bioEnabled();
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', bio ? 'fid' : '', '0', 'del'];
  $('keypad').innerHTML = keys.map(k => k === '' ? '<span></span>'
    : k === 'del' ? '<button class="key ghost" data-k="del" aria-label="Delete">⌫</button>'
    : k === 'fid' ? '<button class="key ghost fid" data-k="fid" aria-label="Unlock with Face ID">☺︎</button>'
    : `<button class="key" data-k="${k}">${k}</button>`).join('');
}
function lockMsg(t, err = false) { const m = $('lockMsg'); m.textContent = t; m.classList.toggle('err', err); }
function shake() { const d = $('dots'); d.classList.remove('shake'); void d.offsetWidth; d.classList.add('shake'); if (navigator.vibrate) navigator.vibrate(80); }

function showLock(mode) {
  lockMode = mode; pinBuf = ''; firstPin = '';
  closeAllSheets();
  $('app').hidden = true; $('lock').hidden = false;
  $('forgot').hidden = mode !== 'unlock';
  $('lockTitle').textContent = mode === 'unlock' ? 'Rands' : 'Welcome to Rands';
  lockMsg(mode === 'unlock' ? 'Enter your passcode' : 'Create a 6-digit passcode');
  drawDots(); drawKeypad(); checkThrottle();
}

function checkThrottle() {
  clearInterval(throttleTimer);
  if (lockMode !== 'unlock') return false;
  const tick = () => {
    const left = Math.ceil((vault.guard().until - Date.now()) / 1000);
    const locked = left > 0;
    $('keypad').querySelectorAll('.key').forEach(b => b.disabled = locked);
    if (locked) lockMsg(`Too many attempts. Try again in ${left >= 60 ? Math.ceil(left / 60) + ' min' : left + 's'}`, true);
    else { clearInterval(throttleTimer); if ($('lockMsg').classList.contains('err') && /Too many/.test($('lockMsg').textContent)) lockMsg('Enter your passcode'); }
    return locked;
  };
  const locked = tick(); if (locked) throttleTimer = setInterval(tick, 1000);
  return locked;
}

async function pressKey(k) {
  if (busy) return;
  if (k === 'fid') return tryBio();
  if (k === 'del') { pinBuf = pinBuf.slice(0, -1); drawDots(); return; }
  if (pinBuf.length >= PIN_LEN) return;
  pinBuf += k; drawDots();
  if (pinBuf.length < PIN_LEN) return;
  const pin = pinBuf;
  busy = true;
  try {
    if (lockMode === 'setup') {
      if (/^(\d)\1{5}$/.test(pin) || '0123456789'.includes(pin) || '9876543210'.includes(pin)) {
        shake(); lockMsg('Too easy to guess — pick another', true); pinBuf = ''; drawDots(); return;
      }
      firstPin = pin; lockMode = 'confirm'; pinBuf = ''; lockMsg('Enter it again to confirm'); drawDots();
    } else if (lockMode === 'confirm') {
      if (pin !== firstPin) { shake(); lockMode = 'setup'; pinBuf = ''; firstPin = ''; lockMsg('Passcodes didn’t match. Try again', true); drawDots(); return; }
      lockMsg('Securing your data…');
      const legacy = vault.legacyData();
      await vault.create(pin, defaults(legacy));
      state = defaults(await vault.load());
      unlocked();
      if (legacy) toast('Your existing expenses are now encrypted');
      offerBio();
    } else {
      if (checkThrottle()) { pinBuf = ''; drawDots(); return; }
      lockMsg('Unlocking…');
      try { state = defaults(await vault.unlockWithPin(pin)); unlocked(); }
      catch { shake(); pinBuf = ''; drawDots(); const g = vault.guard(); lockMsg(g.fails >= 3 && g.fails < 5 ? `Wrong passcode · ${5 - g.fails} tries before a timeout` : 'Wrong passcode', true); checkThrottle(); }
    }
  } finally { busy = false; }
}
$('keypad').addEventListener('click', e => { const b = e.target.closest('[data-k]'); if (b && !b.disabled) pressKey(b.dataset.k); });
document.addEventListener('keydown', e => {
  if ($('lock').hidden || $('dlg').classList.contains('show')) return;
  if (/^\d$/.test(e.key)) pressKey(e.key); else if (e.key === 'Backspace') pressKey('del');
});

async function tryBio() {
  if (busy || checkThrottle()) return;
  busy = true; lockMsg('Waiting for Face ID…');
  try { state = defaults(await vault.unlockWithBio()); unlocked(); }
  catch (e) { lockMsg(e && e.name === 'NotAllowedError' ? 'Tap ☺︎ for Face ID, or enter your passcode' : 'Face ID unavailable — use your passcode'); }
  finally { busy = false; }
}

async function offerBio() {
  if (vault.bioEnabled() || !(await vault.bioAvailable())) return;
  if (await ask('Unlock Rands with Face ID?\nYour passcode still works as a fallback.', 'Use Face ID', false)) enableBio();
}
async function enableBio() {
  try { await vault.enableBio(); toast('Face ID unlock is on'); }
  catch (e) {
    toast(e && e.message === 'noprf' ? 'Face ID unlock needs iOS 18 or later' : (e && e.name === 'NotAllowedError' ? 'Face ID setup cancelled' : 'Couldn’t set up Face ID here'));
  }
  syncSettings();
}

$('forgot').onclick = async () => {
  const ok = await ask('There’s no way to recover a forgotten passcode — your data is encrypted with it.\n\nYou can erase everything on this phone and start again (then restore a backup if you have one).', 'Erase & start over', true);
  if (!ok) return;
  const sure = await dialog({ msg: 'Type ERASE to confirm.', yes: 'Erase', danger: true, input: { type: 'text', placeholder: 'ERASE' }, validate: v => v.trim().toUpperCase() === 'ERASE' ? null : 'Type ERASE to confirm' });
  if (!sure) return;
  vault.eraseEverything(); showLock('setup'); toast('All data erased');
};

function unlocked() {
  $('lock').hidden = true; $('app').hidden = false;
  pinBuf = ''; clearInterval(throttleTimer);
  render();
}

function lockApp() {
  vault.lock(); state = null;
  ['summary', 'cats', 'list'].forEach(id => $(id).innerHTML = '');
  showLock('unlock');
}
$('lockNow').onclick = lockApp;

// auto-lock + hide contents in the app switcher
let hiddenAt = 0;
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { hiddenAt = Date.now(); $('cover').classList.add('show'); }
  else {
    if (state && Date.now() - hiddenAt >= (state.autoLock ?? 60) * 1000) lockApp();
    $('cover').classList.remove('show');
    if (!$('lock').hidden && lockMode === 'unlock') checkThrottle();
  }
});
window.addEventListener('pagehide', () => $('cover').classList.add('show'));
window.addEventListener('pageshow', () => { if (!document.hidden) $('cover').classList.remove('show'); });

// ---------------------------------------------------------------- render
function monthItems(d) {
  const key = ym(d);
  return state.expenses.filter(e => e.date.startsWith(key)).sort((a, b) => b.date.localeCompare(a.date) || b.created - a.created);
}
const catBudgetTotal = () => Object.values(state.catBudgets).reduce((s, v) => s + (v || 0), 0);
const overallBudget = () => state.budget > 0 ? state.budget : catBudgetTotal();

function render() {
  if (!state) return;
  $('monthLabel').textContent = view.toLocaleDateString('en-ZA', { month: 'long', year: 'numeric' });
  const items = monthItems(view);
  const total = items.reduce((s, e) => s + e.amount, 0);
  const now = new Date(), dim = new Date(view.getFullYear(), view.getMonth() + 1, 0).getDate();
  let days = dim; if (ym(view) === ym(now)) days = now.getDate(); else if (view > now) days = 0;
  const avg = days ? Math.round(total / days) : 0;
  const budget = overallBudget();

  let html = `<div class="label">Spent</div><div class="total">${money(total)}</div>`;
  if (budget > 0) {
    const pct = Math.min(100, total / budget * 100), over = total > budget;
    html += `<div class="bar ${over ? 'over' : ''}"><i style="width:${pct}%"></i></div>
      <div class="meta"><span>Budget <b>${money(budget)}</b></span>
      <span class="${over ? 'over-txt' : ''}">${over ? 'Over by' : 'Left'} <b class="${over ? 'over-txt' : ''}">${money(Math.abs(budget - total))}</b></span></div>`;
  }
  html += `<div class="meta" style="margin-top:6px"><span><b>${items.length}</b> expense${items.length === 1 ? '' : 's'}</span>${days ? `<span>Avg <b>${money(avg)}</b>/day</span>` : ''}</div>`;
  $('summary').innerHTML = html;

  const by = {}; items.forEach(e => by[e.cat] = (by[e.cat] || 0) + e.amount);
  const ids = CATS.map(c => c.id).filter(id => by[id] || state.catBudgets[id]);
  ids.sort((a, b) => (by[b] || 0) - (by[a] || 0));
  const card = $('cats');
  if (!ids.length) card.hidden = true;
  else {
    card.hidden = false;
    const max = Math.max(...ids.map(id => by[id] || 0), 1);
    card.innerHTML = `<div class="label" style="margin-bottom:4px">By category</div>` + ids.map(id => {
      const c = CAT[id], amt = by[id] || 0, b = state.catBudgets[id] || 0, over = b && amt > b;
      const width = b ? Math.min(100, amt / b * 100) : amt / max * 100;
      const sub = b ? `<small class="${over ? 'over-txt' : ''}">${over ? 'over by ' + money(amt - b) : 'of ' + money(b)}</small>`
                    : (total ? `<small>${Math.round(amt / total * 100)}%</small>` : '');
      return `<div class="cat-row"><div class="e">${c.emoji}</div>
        <div><div class="n">${c.label}</div><div class="mini"><i style="width:${width}%;background:${over ? 'var(--danger)' : c.color}"></i></div></div>
        <div class="a">${money(amt)}${sub}</div></div>`;
    }).join('');
  }

  const list = $('list');
  if (!items.length) { list.innerHTML = `<div class="empty"><div>🧾</div>No expenses this month.<br>Tap <b>+</b> to add one, or <b>Import</b> a statement.</div>`; return; }
  const groups = {}; items.forEach(e => (groups[e.date] = groups[e.date] || []).push(e));
  list.innerHTML = Object.keys(groups).sort().reverse().map(day => {
    const g = groups[day], dt = parseISO(day);
    const label = day === iso(new Date()) ? 'Today' : dt.toLocaleDateString('en-ZA', { weekday: 'short', day: 'numeric', month: 'short' });
    return `<h2><span>${label}</span><span>${money(g.reduce((s, e) => s + e.amount, 0))}</span></h2>
      <div class="list">${g.map(e => { const c = CAT[e.cat] || CAT.other;
        return `<button class="item" data-id="${e.id}"><div class="b" style="background:${c.color}22">${c.emoji}</div>
          <div><div class="t">${c.label}</div>${e.note ? `<div class="s">${esc(e.note)}</div>` : ''}</div>
          <div class="a">${money(e.amount)}</div></button>`; }).join('')}</div>`;
  }).join('');
}

// ---------------------------------------------------------------- sheets
let openSheet = null;
function show(sheet) {
  if (openSheet && openSheet !== sheet) openSheet.classList.remove('show');
  openSheet = sheet; $('layer').classList.add('open'); requestAnimationFrame(() => sheet.classList.add('show'));
}
function hide() { if (!openSheet) return; openSheet.classList.remove('show'); $('layer').classList.remove('open'); if (document.activeElement) document.activeElement.blur(); openSheet = null; }
function closeAllSheets() { document.querySelectorAll('.sheet.show').forEach(s => s.classList.remove('show')); $('layer').classList.remove('open'); openSheet = null; }
$('backdrop').onclick = hide;
document.querySelectorAll('[data-close]').forEach(b => b.onclick = hide);
document.querySelectorAll('[data-back]').forEach(b => b.onclick = () => { openSettings(); });

// ---- add / edit
let editingId = null, selCat = 'groceries';
function drawChips() { $('chips').innerHTML = CATS.map(c => `<button class="chip ${c.id === selCat ? 'sel' : ''}" data-cat="${c.id}"><span class="e">${c.emoji}</span>${c.label}</button>`).join(''); }
$('chips').onclick = e => { const b = e.target.closest('[data-cat]'); if (!b) return; selCat = b.dataset.cat; drawChips(); };
function openEntry(exp) {
  editingId = exp ? exp.id : null;
  $('entryTitle').textContent = exp ? 'Edit expense' : 'New expense';
  $('amt').value = exp ? (exp.amount / 100).toFixed(2) : '';
  $('note').value = exp ? exp.note || '' : '';
  $('date').value = exp ? exp.date : (ym(view) === ym(new Date()) ? iso(new Date()) : iso(view));
  selCat = exp ? exp.cat : (state.lastCat || 'groceries');
  $('deleteEntry').hidden = !exp;
  drawChips(); validateEntry(); show($('entrySheet'));
  if (!exp) setTimeout(() => $('amt').focus(), 250);
}
function validateEntry() { $('saveEntry').disabled = !(toCents($('amt').value) > 0) || !$('date').value; }
$('amt').oninput = validateEntry; $('date').oninput = validateEntry;
$('note').addEventListener('change', () => {   // suggest a category from the note for new expenses
  if (editingId) return; const g = categorise($('note').value, state.rules); if (g !== 'other') { selCat = g; drawChips(); }
});
$('saveEntry').onclick = () => {
  const amount = toCents($('amt').value); if (!(amount > 0)) return;
  const rec = { amount, cat: selCat, note: $('note').value.trim(), date: $('date').value };
  if (editingId) {
    const e = state.expenses.find(x => x.id === editingId);
    if (e.cat !== rec.cat && rec.note) { const k = merchantKey(rec.note); if (k) state.rules[k] = rec.cat; } // learn
    Object.assign(e, rec); toast('Updated');
  } else { state.expenses.push({ id: uid(), created: Date.now(), ...rec }); toast('Saved ' + money(amount)); }
  state.lastCat = selCat; persist();
  const d = parseISO(rec.date); view = new Date(d.getFullYear(), d.getMonth(), 1);
  hide(); render();
};
$('deleteEntry').onclick = async () => {
  if (!await ask('Delete this expense?', 'Delete')) return;
  state.expenses = state.expenses.filter(e => e.id !== editingId); persist(); hide(); render(); toast('Deleted');
};
$('list').onclick = e => { const b = e.target.closest('.item'); if (b) openEntry(state.expenses.find(x => x.id === b.dataset.id)); };
$('add').onclick = () => openEntry(null);
$('prev').onclick = () => { view = new Date(view.getFullYear(), view.getMonth() - 1, 1); render(); };
$('next').onclick = () => { view = new Date(view.getFullYear(), view.getMonth() + 1, 1); render(); };

let sx = null, sy = null;
document.addEventListener('touchstart', e => { if (openSheet || !state) return; sx = e.touches[0].clientX; sy = e.touches[0].clientY; }, { passive: true });
document.addEventListener('touchend', e => {
  if (sx == null || openSheet) return; const dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy; sx = null;
  if (Math.abs(dx) > 70 && Math.abs(dy) < 40) (dx < 0 ? $('next') : $('prev')).click();
}, { passive: true });

// ---------------------------------------------------------------- settings
async function syncSettings() {
  $('budget').value = state.budget ? (state.budget / 100).toFixed(0) : '';
  const cb = catBudgetTotal();
  $('catBudgetSummary').textContent = cb ? money(cb) + ' ›' : 'Not set ›';
  $('autoLock').value = String(state.autoLock ?? 60);
  const n = Object.keys(state.rules).length; $('rulesCount').textContent = n ? n + ' ›' : '›';
  const avail = await vault.bioAvailable();
  $('bioToggle').disabled = !avail; $('bioToggle').checked = vault.bioEnabled();
  $('bioRow').querySelector('.row-l').textContent = avail ? 'Unlock with Face ID' : 'Face ID (not available here)';
}
function openSettings() { syncSettings(); show($('settingsSheet')); }
$('openSettings').onclick = openSettings;
$('budget').onchange = () => {
  const v = $('budget').value.trim(); const c = v ? toCents(v) : 0;
  if (v && !(c >= 0)) { toast('Invalid amount'); return; }
  state.budget = c || 0; persist(); render(); toast(c ? 'Budget set' : 'Using category budgets');
};
$('autoLock').onchange = () => { state.autoLock = +$('autoLock').value; persist(); };
$('bioToggle').onchange = async () => {
  if ($('bioToggle').checked) await enableBio();
  else { vault.disableBio(); toast('Face ID unlock is off'); }
  syncSettings();
};
$('changePin').onclick = async () => {
  const old = await askSecret('Enter your current passcode', { mode: 'numeric', validate: async v => (await vault.checkPin(v)) ? null : 'That’s not your current passcode' });
  if (old == null) return;
  const nw = await askSecret('New 6-digit passcode', { mode: 'numeric', validate: v => /^\d{6}$/.test(v) ? (/^(\d)\1{5}$/.test(v) || '0123456789'.includes(v) ? 'Too easy to guess' : null) : 'Use exactly 6 digits' });
  if (nw == null) return;
  const again = await askSecret('Confirm new passcode', { mode: 'numeric', validate: v => v === nw ? null : 'Doesn’t match' });
  if (again == null) return;
  await vault.changePin(old, nw); toast('Passcode changed');
};
$('clearRules').onclick = async () => {
  if (!Object.keys(state.rules).length) { toast('Nothing learned yet'); return; }
  if (!await ask('Forget the categories Rands learned from your edits and imports?', 'Forget')) return;
  state.rules = {}; persist(); syncSettings(); toast('Learned categories cleared');
};

// ---- category budgets
$('openCatBudgets').onclick = () => { drawCatBudgets(); show($('catBudgetSheet')); };
function drawCatBudgets() {
  $('catBudgetList').innerHTML = CATS.map(c => `<div class="bud-row"><span>${c.emoji} ${c.label}</span>
    <input inputmode="decimal" data-bcat="${c.id}" placeholder="—" value="${state.catBudgets[c.id] ? (state.catBudgets[c.id] / 100).toFixed(0) : ''}"></div>`).join('');
  $('catBudgetTotal').textContent = 'Total of category budgets: ' + money(catBudgetTotal()) + (state.budget ? ` · Overall budget is set separately to ${money(state.budget)}` : ' · used as your monthly budget');
}
$('catBudgetList').addEventListener('change', e => {
  const inp = e.target.closest('[data-bcat]'); if (!inp) return;
  const v = inp.value.trim(), c = v ? toCents(v) : 0;
  if (v && !(c >= 0)) { toast('Invalid amount'); return; }
  if (c) state.catBudgets[inp.dataset.bcat] = c; else delete state.catBudgets[inp.dataset.bcat];
  persist(); render(); drawCatBudgets();
});

// ---- export / backup
async function deliver(filename, text, type) {
  const blob = new Blob([text], { type });
  try {
    const file = new File([blob], filename, { type });
    if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: filename }); return; }
  } catch (e) { if (e && e.name === 'AbortError') return; }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
function toCsv(items) {
  const q = s => '"' + String(s).replace(/"/g, '""') + '"';
  return 'Date,Category,Amount (ZAR),Note\n' + items.slice().sort((a, b) => a.date.localeCompare(b.date))
    .map(e => [e.date, q((CAT[e.cat] || CAT.other).label), (e.amount / 100).toFixed(2), q(e.note || '')].join(',')).join('\n');
}
async function csvWarn() { return ask('CSV files are not encrypted. Anyone who gets the file can read it.', 'Export', false); }
$('exportCsv').onclick = async () => { if (await csvWarn()) deliver(`rands-${ym(view)}.csv`, toCsv(monthItems(view)), 'text/csv'); };
$('exportAll').onclick = async () => { if (await csvWarn()) deliver(`rands-all-${iso(new Date())}.csv`, toCsv(state.expenses), 'text/csv'); };
$('backup').onclick = async () => {
  const pw = await askSecret('Choose a password for this backup (you’ll need it to restore). It can be your passcode.', { validate: v => v.length >= 6 ? null : 'At least 6 characters' });
  if (pw == null) return;
  const again = await askSecret('Confirm backup password', { validate: v => v === pw ? null : 'Doesn’t match' });
  if (again == null) return;
  const obj = await vault.exportBackup(state, pw);
  deliver(`rands-backup-${iso(new Date())}.json`, JSON.stringify(obj), 'application/json');
};
$('restoreBtn').onclick = () => $('restoreFile').click();
$('restoreFile').onchange = async e => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  let obj; try { obj = JSON.parse(await f.text()); } catch { toast('That file isn’t a Rands backup'); return; }
  let data = null;
  if (obj && obj.format === 'rands-backup') {
    const pw = await askSecret('Password for this backup', {
      validate: async v => { try { data = await vault.importBackup(obj, v); return null; } catch { return 'Wrong password'; } } });
    if (pw == null) return;
  } else if (obj && Array.isArray(obj.expenses)) data = obj;   // older unencrypted backup
  else { toast('That file isn’t a Rands backup'); return; }
  if (!await ask(`Replace current data with ${data.expenses.length} expenses from this backup?`, 'Restore')) return;
  state = defaults({ ...data, autoLock: state.autoLock }); persist(); render(); hide(); toast('Backup restored');
};
$('wipe').onclick = async () => {
  if (!await ask('Erase ALL expenses, budgets and your passcode from this phone? This cannot be undone.', 'Erase')) return;
  vault.eraseEverything(); state = null; showLock('setup'); toast('All data erased');
};

// ---------------------------------------------------------------- import
let imp = null;   // { results, idx, result, rows:[...] }
$('openImport').onclick = $('importBtn2').onclick = () => startImport();
function startImport() {
  imp = null;
  $('importBody').innerHTML = `<div class="picker" id="pick"><div style="font-size:34px">📄</div>
    <b>Choose a file</b><br>Bank statement (PDF, Excel or CSV), your own expense spreadsheet, or a budget sheet.<br><br>
    <span style="font-size:12.5px">Rands works out the columns, categorises merchants and skips duplicates. Files are read on your phone only.</span></div>`;
  $('importGo').disabled = true; $('importGo').textContent = 'Import';
  $('pick').onclick = () => $('importFile').click();
  show($('importSheet'));
  setTimeout(() => $('importFile').click(), 300);
}
$('importFile').onchange = async e => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  if (!openSheet) show($('importSheet'));
  $('importBody').innerHTML = `<div class="spinner"></div><p style="text-align:center;color:var(--muted)">Reading ${esc(f.name)}…</p>`;
  try {
    const read = await readFile(f, retry => askSecret(retry ? 'Wrong password. Try again:' : 'This PDF is password-protected. Enter its password\n(SA banks often use your ID number):', { yes: 'Open' }));
    const results = analyse(read);
    imp = { file: f.name, read, results, idx: 0 };
    buildRows(); drawImport();
  } catch (err) {
    $('importBody').innerHTML = `<div class="picker" id="pick"><div style="font-size:34px">⚠️</div><b>Couldn’t import that file</b><br>${esc(err.message || err)}<br><br><span class="link">Choose another file</span></div>`;
    $('pick').onclick = () => $('importFile').click();
  }
};

function buildRows() {
  const r = imp.results[imp.idx]; imp.result = r;
  if (r.kind === 'transactions') {
    markDuplicates(r.txns, state.expenses);
    imp.rows = r.txns.map((t, i) => ({ ...t, i, cat: t.credit ? 'other' : categorise(t.desc, state.rules, t.srcCategory), on: !t.credit && !t.dup, touched: false }));
  } else if (r.kind === 'budget') {
    imp.rows = r.items.map((b, i) => ({ ...b, i, on: true }));
    imp.setOverall = !state.budget;
  } else imp.rows = [];
}

function colOptions(r, selected) {
  const n = r.width || 0;
  const letter = j => String.fromCharCode(65 + (j % 26));
  let o = `<option value="">—</option>`;
  for (let j = 0; j < n; j++) { const h = (r.header || [])[j]; o += `<option value="${j}" ${selected === j ? 'selected' : ''}>${letter(j)}${h ? ' · ' + esc(String(h).slice(0, 28)) : ''}</option>`; }
  return o;
}

function drawImport() {
  const r = imp.result; const body = $('importBody');
  let h = '';
  if (imp.results.length > 1) {
    h += `<label class="field"><small>Sheet</small><select class="select" id="impSheet" style="max-width:100%;width:100%">${imp.results.map((x, i) =>
      `<option value="${i}" ${i === imp.idx ? 'selected' : ''}>${esc(x.name)} — ${x.kind === 'transactions' ? x.txns.length + ' transactions' : x.kind === 'budget' ? 'budget sheet' : 'not recognised'}</option>`).join('')}</select></label>`;
  }
  const srcLabel = r.source === 'pdf' ? 'PDF statement' : r.source === 'xlsx' ? 'Excel' : 'CSV';

  if (r.kind === 'transactions') {
    const exp = imp.rows.filter(x => !x.credit), inn = imp.rows.filter(x => x.credit), dups = imp.rows.filter(x => x.dup);
    const hasCats = imp.rows.some(x => x.srcCategory);
    const kindLabel = hasCats ? 'Categorised expense sheet' : (inn.length ? 'Bank statement' : 'Expense list');
    const dates = imp.rows.map(x => x.date).sort();
    h += `<div class="imp-sum"><b>${kindLabel}</b> · ${srcLabel}<br>
      <span class="k"><b>${exp.length}</b> money out</span><span class="k"><b>${inn.length}</b> money in</span><span class="k"><b>${dups.length}</b> already in Rands</span><br>
      <span class="k">${dates.length ? shortDate(dates[0]) + ' – ' + shortDate(dates[dates.length - 1]) : ''}</span></div>`;
  } else if (r.kind === 'budget') {
    h += `<div class="imp-sum"><b>Budget sheet</b> · ${srcLabel}<br><span class="k"><b>${imp.rows.length}</b> budget lines · total <b>${money(imp.rows.reduce((s, x) => s + x.cents, 0))}</b>/month</span></div>`;
  } else {
    h += `<div class="imp-sum"><b>Couldn’t detect the layout automatically.</b><br>${r.source === 'pdf'
      ? 'No transaction lines were found in this PDF. If it’s a scanned image, export a CSV or Excel statement from your banking app instead.'
      : 'Tell Rands which columns hold what below.'}</div>`;
  }

  if (r.source !== 'pdf' && r.map) {
    const m = r.map;
    h += `<details class="cols" ${r.kind === 'unknown' ? 'open' : ''}><summary>Columns detected</summary><div class="colmap">
      ${[['date', 'Date'], ['desc', 'Description'], ['amount', 'Amount'], ['debit', 'Money out'], ['credit', 'Money in'], ['category', 'Category'], ['budget', 'Budget']].map(([k, l]) =>
        `<span>${l}</span><select class="select" data-col="${k}">${colOptions(r, m[k])}</select>`).join('')}
      <span>Header row</span><select class="select" data-col="headerIdx">${Array.from({ length: Math.min(30, imp.results[imp.idx].sheet.rows.length) }, (_, i) =>
        `<option value="${i}" ${r.headerIdx === i ? 'selected' : ''}>Row ${i + 1}</option>`).join('')}<option value="-1" ${r.headerIdx === -1 ? 'selected' : ''}>No header</option></select>
    </div></details>`;
  }

  if (r.kind === 'transactions') {
    const out = imp.rows.filter(x => !x.credit), inn = imp.rows.filter(x => x.credit);
    const row = x => `<div class="imp-row ${x.on ? '' : 'off'}" data-row="${x.i}">
      <input type="checkbox" ${x.on ? 'checked' : ''} data-on="${x.i}">
      <div style="min-width:0"><div class="d">${esc(x.desc || '(no description)')}</div>
        <div class="sub">${shortDate(x.date)}
          <select class="sel-cat" data-cat="${x.i}">${CATS.map(c => `<option value="${c.id}" ${c.id === x.cat ? 'selected' : ''}>${c.emoji} ${c.label}</option>`).join('')}</select>
          ${x.dup ? '<span class="badge">duplicate</span>' : ''}${x.credit ? '<span class="badge in">money in</span>' : ''}</div></div>
      <div class="amt">${money(x.cents)}</div></div>`;
    h += `<div class="imp-tools"><span>Tap a category to change it — similar merchants follow.</span><span><button class="link small" id="selAll">All</button><button class="link small" id="selNone">None</button></span></div>`;
    h += out.map(row).join('') || '<p class="fine">No money-out rows found.</p>';
    if (inn.length) h += `<div class="sec-h">Money in · not imported unless ticked</div>` + inn.map(row).join('');
  } else if (r.kind === 'budget') {
    h += imp.rows.map(x => `<div class="imp-row" data-row="${x.i}"><input type="checkbox" ${x.on ? 'checked' : ''} data-on="${x.i}">
      <div style="min-width:0"><div class="d">${esc(x.label)}</div><div class="sub">→ <select class="sel-cat" data-cat="${x.i}">${CATS.map(c => `<option value="${c.id}" ${c.id === x.cat ? 'selected' : ''}>${c.emoji} ${c.label}</option>`).join('')}</select></div></div>
      <div class="amt">${money(x.cents)}</div></div>`).join('');
    h += `<div class="row-btn static" style="margin-top:8px"><span class="row-l">Use the total as my overall monthly budget</span><label class="switch"><input type="checkbox" id="setOverall" ${imp.setOverall ? 'checked' : ''}><i></i></label></div>
      <p class="fine">Lines that map to the same category are added together. Existing category budgets are replaced for the categories in this sheet.</p>`;
  }
  h += `<p style="text-align:center"><button class="link small" id="pickAgain">Choose a different file</button></p>`;
  body.innerHTML = h;
  updateImportButton();

  const sheetSel = $('impSheet'); if (sheetSel) sheetSel.onchange = () => { imp.idx = +sheetSel.value; buildRows(); drawImport(); };
  body.querySelectorAll('[data-col]').forEach(sel => sel.onchange = () => {
    const base = imp.results[imp.idx];
    const map = { ...base.map }; let headerIdx = base.headerIdx;
    body.querySelectorAll('[data-col]').forEach(s => {
      if (s.dataset.col === 'headerIdx') headerIdx = +s.value;
      else if (s.value === '') delete map[s.dataset.col]; else map[s.dataset.col] = +s.value;
    });
    const res = { name: base.name, source: base.source, sheet: base.sheet, ...analyseTable(base.sheet, { map, headerIdx }) };
    res.header = res.header && res.header.length ? res.header : base.header;
    imp.results[imp.idx] = res; buildRows(); drawImport();
  });
  $('pickAgain').onclick = () => $('importFile').click();
  if ($('selAll')) $('selAll').onclick = () => { imp.rows.forEach(x => { if (!x.credit) x.on = true; }); drawImport(); };
  if ($('selNone')) $('selNone').onclick = () => { imp.rows.forEach(x => x.on = false); drawImport(); };
  if ($('setOverall')) $('setOverall').onchange = e => { imp.setOverall = e.target.checked; };
}

$('importBody').addEventListener('change', e => {
  if (!imp) return;
  const on = e.target.closest('[data-on]');
  if (on) { const x = imp.rows[+on.dataset.on]; x.on = on.checked; on.closest('.imp-row').classList.toggle('off', !x.on); updateImportButton(); return; }
  const cs = e.target.closest('select[data-cat]');
  if (cs) {
    const x = imp.rows[+cs.dataset.cat]; x.cat = cs.value; x.touched = true;
    if (imp.result.kind === 'transactions') {
      const key = merchantKey(x.desc); let n = 0;
      if (key) imp.rows.forEach(y => { if (y !== x && !y.touched && merchantKey(y.desc) === key && y.cat !== x.cat) { y.cat = x.cat; n++; } });
      x.learn = true;
      if (n) { drawImport(); toast(`Also changed ${n} similar`); }
    }
    updateImportButton();
  }
});

function updateImportButton() {
  const r = imp && imp.result; const btn = $('importGo');
  if (!r || r.kind === 'unknown') { btn.disabled = true; btn.textContent = 'Import'; return; }
  const sel = imp.rows.filter(x => x.on);
  if (r.kind === 'budget') { btn.disabled = !sel.length; btn.textContent = `Apply ${sel.length} budget${sel.length === 1 ? '' : 's'}`; return; }
  btn.disabled = !sel.length;
  btn.textContent = sel.length ? `Import ${sel.length} expense${sel.length === 1 ? '' : 's'} · ${money(sel.reduce((s, x) => s + x.cents, 0))}` : 'Nothing selected';
}

$('importGo').onclick = () => {
  const r = imp.result; const sel = imp.rows.filter(x => x.on);
  if (r.kind === 'budget') {
    const sums = {}; sel.forEach(x => sums[x.cat] = (sums[x.cat] || 0) + x.cents);
    Object.assign(state.catBudgets, sums);
    if (imp.setOverall) state.budget = 0;   // overall = sum of category budgets
    persist(); render(); hide(); toast(`Budgets set for ${Object.keys(sums).length} categories`);
    return;
  }
  const now = Date.now();
  sel.forEach((x, k) => state.expenses.push({ id: uid(), created: now + k, amount: x.cents, cat: x.cat, note: x.desc.slice(0, 80), date: x.date, src: 'import' }));
  imp.rows.filter(x => x.learn).forEach(x => { const k = merchantKey(x.desc); if (k) state.rules[k] = x.cat; });
  persist();
  const latest = sel.map(x => x.date).sort().pop();
  if (latest) { const d = parseISO(latest); view = new Date(d.getFullYear(), d.getMonth(), 1); }
  hide(); render(); toast(`Imported ${sel.length} expenses`);
};

// ---------------------------------------------------------------- boot
const standalone = window.navigator.standalone || matchMedia('(display-mode: standalone)').matches;
if (!standalone && /iphone|ipad|ipod/i.test(navigator.userAgent)) $('installHint').hidden = false;
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
if (!window.crypto || !crypto.subtle) {
  $('lockMsg').textContent = 'Rands needs a secure (https) connection to encrypt your data.';
} else {
  showLock(vault.exists() ? 'unlock' : 'setup');
  if (vault.exists() && vault.bioEnabled()) setTimeout(tryBio, 400);
}
