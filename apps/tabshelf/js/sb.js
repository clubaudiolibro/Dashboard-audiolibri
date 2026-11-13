/**
 * sb.js — Client Supabase e autenticazione (email + password).
 * La libreria supabase-js (UMD) è caricata da index.html e crea window.supabase.
 */
import { KEYS, SCHEMA_VERSION } from './config.js';

let client = null;

export function initClient(cfg) {
  if (!window.supabase || !window.supabase.createClient) {
    throw new Error('Impossibile caricare la libreria di Supabase: controlla la connessione e ricarica la pagina.');
  }
  client = window.supabase.createClient(cfg.url, cfg.key, {
    auth: {
      persistSession: true,        // la sessione resta salvata in questo browser
      autoRefreshToken: true,      // rinnovo automatico del token
      detectSessionInUrl: false,   // l'hash dell'indirizzo lo gestiamo noi (#cfg=, #/rotte)
      storageKey: KEYS.auth,
    },
  });
  return client;
}

/** Il client attivo (dopo initClient). */
export function sb() {
  if (!client) throw new Error('Client Supabase non inizializzato.');
  return client;
}

export async function getUser() {
  const { data } = await sb().auth.getSession();
  return data.session ? data.session.user : null;
}

export async function signIn(email, password) {
  const { data, error } = await sb().auth.signInWithPassword({ email: email.trim(), password });
  if (error) throw error;
  return data.user;
}

export async function signOut() {
  // scope 'local': esce solo da questo dispositivo
  await sb().auth.signOut({ scope: 'local' }).catch(() => {});
  localStorage.removeItem(KEYS.auth);
}

/** Chiama una funzione del database e lancia un errore se fallisce. */
export async function rpc(name, args = {}) {
  const { data, error } = await sb().rpc(name, args);
  if (error) throw error;
  return data;
}

/**
 * Verifica che setup.sql sia stato eseguito e sia aggiornato.
 * Restituisce { ok, found, expected, message }.
 */
export async function checkSchema() {
  const { data, error } = await sb().rpc('tabshelf_schema_version');
  if (error) {
    return { ok: false, found: null, expected: SCHEMA_VERSION,
      message: 'Il database non è ancora preparato: esegui supabase/setup.sql nel SQL Editor di Supabase.' };
  }
  const found = Number(data);
  if (found < SCHEMA_VERSION) {
    return { ok: false, found, expected: SCHEMA_VERSION,
      message: `Il database è a una versione precedente (${found}): esegui di nuovo supabase/setup.sql aggiornato.` };
  }
  return { ok: true, found, expected: SCHEMA_VERSION, message: '' };
}

/**
 * Legge tutte le righe di una tabella superando il limite di 1000 righe per richiesta.
 */
export async function fetchAll(table, columns = '*', { order = 'created_at', pageSize = 1000 } = {}) {
  const out = [];
  for (let from = 0; ; from += pageSize) {
    let q = sb().from(table).select(columns).range(from, from + pageSize - 1);
    if (order) q = q.order(order, { ascending: true });
    const { data, error } = await q;
    if (error) throw error;
    out.push(...data);
    if (data.length < pageSize) break;
  }
  return out;
}
