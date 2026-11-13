/**
 * util.js — Piccole funzioni di uso generale.
 */

/** Escape HTML per inserire testo dell'utente nei template. */
export function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Crea un elemento DOM da una stringa HTML (primo elemento). */
export function h(str) {
  const t = document.createElement('template');
  t.innerHTML = str.trim();
  return t.content.firstElementChild;
}

/** Identificativo univoco. */
export function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const x = [...b].map((v) => v.toString(16).padStart(2, '0')).join('');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}

/** Byte in forma leggibile, all'italiana (es. "12,4 MB"). */
export function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0; let v = n;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(i === 0 ? 0 : 1).replace('.', ',')} ${units[i]}`;
}

/** Data in formato italiano. */
export function formatDate(value, withTime = false) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  const o = { day: '2-digit', month: '2-digit', year: 'numeric' };
  if (withTime) { o.hour = '2-digit'; o.minute = '2-digit'; }
  return d.toLocaleString('it-IT', o);
}

/** Testo normalizzato per la ricerca (minuscolo, senza accenti). */
export function norm(s) {
  return String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

export function debounce(fn, ms = 200) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

/** Codifica/decodifica base64url di testo UTF-8. */
export function toBase64Url(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  bytes.forEach((b) => { bin += String.fromCharCode(b); });
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function fromBase64Url(str) {
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((str.length + 3) % 4);
  const bin = atob(b64);
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

/** Messaggio d'errore leggibile in italiano. */
export function errorMessage(err) {
  if (!err) return 'Errore sconosciuto.';
  const msg = String(err.message || err.error_description || err.msg || err);
  if (/Failed to fetch|NetworkError|Load failed|network/i.test(msg)) return 'Connessione assente o server non raggiungibile. Riprova tra poco.';
  if (/Invalid login credentials/i.test(msg)) return 'Email o password non corrette.';
  if (/Email not confirmed/i.test(msg)) return 'L\'utente non è confermato: in Supabase crealo con "Auto Confirm User" attivo.';
  if (/JWT expired|invalid JWT|refresh_token/i.test(msg)) return 'La sessione è scaduta: accedi di nuovo.';
  if (/Invalid API key|No API key/i.test(msg)) return 'La chiave pubblica non è valida per questo progetto.';
  if (/duplicate key|unique/i.test(msg)) return 'Esiste già un elemento con lo stesso nome.';
  if (/row-level security|permission denied/i.test(msg)) return 'Operazione non permessa dalle regole di sicurezza del database (hai eseguito setup.sql?).';
  if (/Payload too large|exceeded the maximum allowed size/i.test(msg)) return 'File troppo grande per lo spazio di archiviazione.';
  return msg;
}

/** Copia un testo negli appunti (con ripiego per i browser più vecchi). */
export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* ripiego sotto */ }
  const ta = document.createElement('textarea');
  ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
  document.body.appendChild(ta); ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { ok = false; }
  ta.remove();
  return ok;
}

/** Carica una sola volta uno script classico (es. jszip). */
const loadedScripts = new Map();
export function loadScript(src) {
  if (!loadedScripts.has(src)) {
    loadedScripts.set(src, new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src; s.crossOrigin = 'anonymous'; s.onload = resolve;
      s.onerror = () => { loadedScripts.delete(src); reject(new Error('Impossibile scaricare una libreria necessaria: controlla la connessione.')); };
      document.head.appendChild(s);
    }));
  }
  return loadedScripts.get(src);
}
