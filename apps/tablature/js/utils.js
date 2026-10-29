/**
 * utils.js — Costanti e funzioni di utilità condivise da tutti i moduli.
 */

/** Versione dell'applicazione (mostrata in Impostazioni). */
export const APP_VERSION = '1.0.0';

/** Livello massimo consentito nella gerarchia delle categorie. */
export const MAX_CATEGORY_LEVEL = 4;

/** Forme CAGED disponibili (ordine canonico C-A-G-E-D). */
export const CAGED_SHAPES = ['C-Shape', 'A-Shape', 'G-Shape', 'E-Shape', 'D-Shape'];

/** Tonalità predefinite, comprese le enarmonie. */
export const KEYS = ['C', 'C#', 'Db', 'D', 'D#', 'Eb', 'E', 'F', 'F#', 'Gb', 'G', 'G#', 'Ab', 'A', 'A#', 'Bb', 'B'];

/** Parametri di elaborazione immagini. */
export const IMAGE_MAX_SIDE = 2400;      // lato maggiore massimo dell'immagine principale
export const THUMB_MAX_SIDE = 600;       // lato maggiore della miniatura
export const IMAGE_QUALITY = 0.92;       // qualità alta: preserva linee e numeri
export const THUMB_QUALITY = 0.8;
export const KEEP_AS_IS_MAX_BYTES = 2.5 * 1024 * 1024; // PNG/WebP piccoli non vengono ricodificati

/** Genera un ID univoco (crypto.randomUUID quando disponibile). */
export function uid() {
  if (globalThis.crypto && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

/** Escape HTML per inserire testo utente in template string. */
export function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Formatta una data ISO/timestamp in formato italiano. */
export function formatDate(value, withTime = false) {
  if (!value) return '—';
  const d = new Date(value);
  if (isNaN(d)) return '—';
  const opts = { day: '2-digit', month: '2-digit', year: 'numeric' };
  if (withTime) { opts.hour = '2-digit'; opts.minute = '2-digit'; }
  return d.toLocaleString('it-IT', opts);
}

/** Data in formato AAAA-MM-GG (per i nomi dei file). */
export function isoDay(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Formatta un numero di byte in forma leggibile. */
export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0; let v = bytes;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(i === 0 ? 0 : 1).replace('.', ',')} ${units[i]}`;
}

/** Debounce classico. */
export function debounce(fn, ms = 200) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

/** Normalizza testo per la ricerca (minuscolo, senza accenti). */
export function norm(s) {
  return String(s ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/** Crea un elemento DOM da una stringa HTML (primo elemento). */
export function html(str) {
  const t = document.createElement('template');
  t.innerHTML = str.trim();
  return t.content.firstElementChild;
}

/** Scarica un Blob con il nome indicato. */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Estensione file a partire dal MIME type. */
export function extFromMime(mime) {
  const map = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif', 'image/bmp': 'bmp', 'application/pdf': 'pdf' };
  return map[mime] || 'bin';
}

/** MIME type a partire dall'estensione (usato in importazione backup). */
export function mimeFromExt(name) {
  const ext = String(name).split('.').pop().toLowerCase();
  const map = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif', bmp: 'image/bmp', pdf: 'application/pdf' };
  return map[ext] || 'application/octet-stream';
}

/** Mescola un array (Fisher-Yates) restituendo una copia. */
export function shuffled(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Confronto alfabetico italiano. */
export const collator = new Intl.Collator('it', { sensitivity: 'base', numeric: true });

/** Traduce gli errori tecnici in messaggi chiari in italiano. */
export function errorMessage(err) {
  if (!err) return 'Errore sconosciuto.';
  const name = err.name || '';
  if (name === 'QuotaExceededError' || /quota/i.test(err.message || '')) {
    return 'Spazio di archiviazione insufficiente. Esporta un backup e libera spazio eliminando tablature non necessarie.';
  }
  if (name === 'NotAllowedError') return 'Operazione non consentita dal browser.';
  if (name === 'AbortError') return 'Operazione annullata.';
  if (name === 'InvalidStateError') return 'Il database non è disponibile (navigazione privata o permessi negati?).';
  return err.userMessage || err.message || String(err);
}

/** Errore con messaggio destinato all'utente. */
export class UserError extends Error {
  constructor(message) { super(message); this.userMessage = message; }
}

/** Attende il prossimo frame (per lasciare respirare la UI nei cicli lunghi). */
export const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
