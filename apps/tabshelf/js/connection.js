/**
 * connection.js — Dati di collegamento al progetto Supabase (Project URL + chiave pubblica).
 *
 * Non sono nel codice: si incollano al primo avvio oppure arrivano da un "link di
 * configurazione" del tipo  index.html#cfg=<base64url di {"url":..., "key":...}>.
 * Il frammento dopo # non viene mai inviato al server; l'app lo legge, salva i dati
 * in localStorage e lo toglie subito dalla barra degli indirizzi.
 */
import { KEYS } from './config.js';
import { toBase64Url, fromBase64Url } from './util.js';

/** Legge la configurazione salvata (o null). */
export function loadConfig() {
  try {
    const c = JSON.parse(localStorage.getItem(KEYS.config) || 'null');
    return c && c.url && c.key ? c : null;
  } catch { return null; }
}

export function saveConfig(cfg) {
  localStorage.setItem(KEYS.config, JSON.stringify({ url: cfg.url, key: cfg.key }));
}

export function clearConfig() {
  localStorage.removeItem(KEYS.config);
  localStorage.removeItem(KEYS.auth);
}

/**
 * Controlla e normalizza i dati incollati. Lancia un Error con messaggio in italiano.
 * Rifiuta in ogni caso le chiavi segrete (service_role / sb_secret_).
 */
export function validateConfig(rawUrl, rawKey) {
  let url = String(rawUrl || '').trim().replace(/\/+$/, '');
  const key = String(rawKey || '').trim().replace(/\s+/g, '');
  if (!url) throw new Error('Incolla il Project URL.');
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  let parsed;
  try { parsed = new URL(url); } catch { throw new Error('Il Project URL non è un indirizzo valido.'); }
  if (parsed.protocol !== 'https:') throw new Error('Il Project URL deve iniziare con https://');
  if (parsed.pathname !== '/' && parsed.pathname !== '') {
    throw new Error('Incolla solo l\'indirizzo del progetto, senza percorsi (es. https://xxxx.supabase.co).');
  }
  url = parsed.origin;
  if (!key) throw new Error('Incolla la chiave pubblica.');
  if (isSecretKey(key)) {
    throw new Error('Questa è una chiave SEGRETA (secret / service_role): non usarla mai nell\'app. Copia invece la chiave pubblica (publishable / anon).');
  }
  if (!/^sb_publishable_/.test(key) && jwtRole(key) !== 'anon') {
    throw new Error('La chiave non sembra quella pubblica: deve iniziare con "sb_publishable_" oppure essere la chiave "anon".');
  }
  return { url, key };
}

function isSecretKey(key) {
  return /^sb_secret_/.test(key) || jwtRole(key) === 'service_role';
}

/** Ruolo contenuto in una chiave JWT "legacy" (anon o service_role), se leggibile. */
function jwtRole(key) {
  const parts = key.split('.');
  if (parts.length !== 3) return null;
  try { return JSON.parse(fromBase64Url(parts[1])).role || null; } catch { return null; }
}

/**
 * Se l'indirizzo contiene #cfg=..., salva la configurazione e ripulisce subito l'indirizzo.
 * Restituisce { applied: true } oppure { error } oppure null se non c'era nulla.
 */
export function consumeConfigHash() {
  const m = location.hash.match(/^#cfg=([A-Za-z0-9_-]+)/);
  if (!m) return null;
  // Prima di tutto togliamo i dati dalla barra degli indirizzi (e dalla cronologia).
  history.replaceState(null, '', location.pathname + location.search + '#/');
  try {
    const obj = JSON.parse(fromBase64Url(m[1]));
    const cfg = validateConfig(obj.url, obj.key);
    const prev = loadConfig();
    if (prev && prev.url !== cfg.url) localStorage.removeItem(KEYS.auth); // progetto diverso: nuova sessione
    saveConfig(cfg);
    return { applied: true };
  } catch (e) {
    return { error: e.message || 'Link di configurazione non valido.' };
  }
}

/** Costruisce il link di configurazione per un altro dispositivo. */
export function buildConfigLink(cfg) {
  const base = location.origin + location.pathname;
  return `${base}#cfg=${toBase64Url(JSON.stringify({ url: cfg.url, key: cfg.key }))}`;
}

/**
 * Prova i dati inseriti chiedendo al servizio di autenticazione le sue impostazioni pubbliche.
 * Restituisce { signupDisabled: boolean|null }.
 */
export async function testConfig(cfg) {
  let res;
  try {
    res = await fetch(`${cfg.url}/auth/v1/settings`, { headers: { apikey: cfg.key }, referrerPolicy: 'no-referrer' });
  } catch {
    throw new Error('Impossibile raggiungere il progetto: controlla il Project URL e la connessione. Se il progetto è in pausa, riattivalo dal pannello di Supabase.');
  }
  if (res.status === 401 || res.status === 403) throw new Error('La chiave pubblica non è valida per questo progetto.');
  if (!res.ok) throw new Error(`Il progetto ha risposto con un errore (${res.status}). Controlla il Project URL.`);
  const json = await res.json().catch(() => ({}));
  return { signupDisabled: typeof json.disable_signup === 'boolean' ? json.disable_signup : null };
}
