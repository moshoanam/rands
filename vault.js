// Rands vault: everything you log is encrypted on this phone.
//
//  - A random 256-bit data key (DEK) encrypts your data with AES-GCM.
//  - The DEK is wrapped (encrypted) by a key derived from your passcode
//    with PBKDF2-SHA256 (600,000 iterations, random salt).
//  - Optionally the DEK is also wrapped by a key that only Face ID / Touch ID
//    can release, using the WebAuthn "PRF" extension of a passkey (iOS 18+).
//  - The DEK only lives in memory while the app is unlocked.
// Nothing is ever sent to a server.

const VKEY = 'rands.vault';
const GKEY = 'rands.guard';
const LEGACY = 'rands.v1';
const ITER = 600000;
const enc = new TextEncoder(), dec = new TextDecoder();

const b64 = buf => { const b = new Uint8Array(buf); let s = ''; for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]); return btoa(s); };
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const rand = n => crypto.getRandomValues(new Uint8Array(n));

function readJSON(k) { try { const s = localStorage.getItem(k); return s ? JSON.parse(s) : null; } catch { return null; } }
function writeJSON(k, v) { localStorage.setItem(k, JSON.stringify(v)); }

async function pinKey(pin, salt, iter = ITER) {
  const base = await crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, base,
    { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
async function hkdfKey(secret, info) {
  const base = await crypto.subtle.importKey('raw', secret, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: enc.encode(info) }, base,
    { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
async function seal(key, bytes) { const iv = rand(12); const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes); return { iv: b64(iv), ct: b64(ct) }; }
async function open(key, box) { return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(box.iv) }, key, unb64(box.ct))); }

let dekRaw = null;   // Uint8Array, only while unlocked
let dekKey = null;   // CryptoKey, only while unlocked

async function useDek(raw) {
  dekRaw = raw;
  dekKey = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export const vault = {
  exists: () => !!readJSON(VKEY),
  isUnlocked: () => !!dekKey,
  legacyData() { const d = readJSON(LEGACY); return d && Array.isArray(d.expenses) ? d : null; },
  bioEnabled: () => !!(readJSON(VKEY) || {}).bio,

  async create(pin, state) {
    const salt = rand(16), raw = rand(32);
    const kek = await pinKey(pin, salt);
    const v = { v: 1, kdf: { salt: b64(salt), iter: ITER }, pinWrap: await seal(kek, raw) };
    await useDek(raw);
    v.data = await seal(dekKey, enc.encode(JSON.stringify(state)));
    writeJSON(VKEY, v);
    try { localStorage.removeItem(LEGACY); } catch {}   // drop old unencrypted copy
    this.resetGuard();
  },

  async unlockWithPin(pin) {
    const v = readJSON(VKEY);
    const kek = await pinKey(pin, unb64(v.kdf.salt), v.kdf.iter);
    let raw;
    try { raw = await open(kek, v.pinWrap); } catch { this.recordFail(); throw new Error('wrong'); }
    await useDek(raw); this.resetGuard();
    return this.load();
  },

  async load() {
    const v = readJSON(VKEY);
    return JSON.parse(dec.decode(await open(dekKey, v.data)));
  },

  async save(state) {
    if (!dekKey) return;
    const v = readJSON(VKEY);
    v.data = await seal(dekKey, enc.encode(JSON.stringify(state)));
    writeJSON(VKEY, v);
  },

  lock() { if (dekRaw) dekRaw.fill(0); dekRaw = null; dekKey = null; },

  async changePin(oldPin, newPin) {
    const v = readJSON(VKEY);
    const raw = await open(await pinKey(oldPin, unb64(v.kdf.salt), v.kdf.iter), v.pinWrap); // throws if wrong
    const salt = rand(16);
    v.kdf = { salt: b64(salt), iter: ITER };
    v.pinWrap = await seal(await pinKey(newPin, salt), raw);
    writeJSON(VKEY, v);
  },

  async checkPin(pin) {
    const v = readJSON(VKEY);
    try { await open(await pinKey(pin, unb64(v.kdf.salt), v.kdf.iter), v.pinWrap); return true; } catch { return false; }
  },

  // ---- Face ID / Touch ID via passkey + PRF ----
  bioAvailable: async () => {
    try { return !!(window.PublicKeyCredential && await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()); }
    catch { return false; }
  },

  async enableBio() {
    if (!dekRaw) throw new Error('locked');
    const prfSalt = rand(32);
    const cred = await navigator.credentials.create({ publicKey: {
      challenge: rand(32),
      rp: { name: 'Rands', id: location.hostname },
      user: { id: rand(16), name: 'Rands on this iPhone', displayName: 'Rands' },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: 'platform', residentKey: 'required', userVerification: 'required' },
      extensions: { prf: { eval: { first: prfSalt } } },
    }});
    const ext = cred.getClientExtensionResults ? cred.getClientExtensionResults() : {};
    if (!ext.prf || ext.prf.enabled === false) throw new Error('noprf');
    let secret = ext.prf.results && ext.prf.results.first;
    if (!secret) secret = await prfGet(cred.rawId, prfSalt);   // iOS returns PRF output only on get()
    if (!secret) throw new Error('noprf');
    const v = readJSON(VKEY);
    v.bio = { credId: b64(cred.rawId), prfSalt: b64(prfSalt), wrap: await seal(await hkdfKey(new Uint8Array(secret), 'rands-dek-wrap'), dekRaw) };
    writeJSON(VKEY, v);
  },

  async unlockWithBio() {
    const v = readJSON(VKEY);
    const secret = await prfGet(unb64(v.bio.credId), unb64(v.bio.prfSalt));
    if (!secret) throw new Error('noprf');
    const raw = await open(await hkdfKey(new Uint8Array(secret), 'rands-dek-wrap'), v.bio.wrap);
    await useDek(raw); this.resetGuard();
    return this.load();
  },

  disableBio() { const v = readJSON(VKEY); delete v.bio; writeJSON(VKEY, v); },

  // ---- brute-force throttle ----
  guard() { return readJSON(GKEY) || { fails: 0, until: 0 }; },
  recordFail() {
    const g = this.guard(); g.fails++;
    if (g.fails >= 5) g.until = Date.now() + Math.min(3600e3, 30e3 * 2 ** (g.fails - 5)); // 30s, 1m, 2m … max 1h
    writeJSON(GKEY, g);
  },
  resetGuard() { try { localStorage.removeItem(GKEY); } catch {} },

  // ---- encrypted backups (protected by a passcode, independent of this phone) ----
  async exportBackup(state, pin) {
    const salt = rand(16);
    return { format: 'rands-backup', v: 1, kdf: { salt: b64(salt), iter: ITER },
      box: await seal(await pinKey(pin, salt), enc.encode(JSON.stringify(state))) };
  },
  async importBackup(obj, pin) {
    const key = await pinKey(pin, unb64(obj.kdf.salt), obj.kdf.iter);
    return JSON.parse(dec.decode(await open(key, obj.box)));   // throws if wrong passcode
  },

  eraseEverything() { [VKEY, GKEY, LEGACY].forEach(k => { try { localStorage.removeItem(k); } catch {} }); this.lock(); },
};

async function prfGet(credId, prfSalt) {
  const a = await navigator.credentials.get({ publicKey: {
    challenge: rand(32), rpId: location.hostname, userVerification: 'required',
    allowCredentials: [{ type: 'public-key', id: credId }],
    extensions: { prf: { eval: { first: prfSalt } } },
  }});
  const r = a.getClientExtensionResults ? a.getClientExtensionResults() : {};
  return r.prf && r.prf.results && r.prf.results.first;
}
