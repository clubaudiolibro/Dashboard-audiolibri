/* TOOLBOX — accesso condiviso (Supabase Auth, email + password).
   Usa gli STESSI nomi di memoria di TabShelf: una sola sessione vale per tutte le app. */
"use strict";
(function () {
  const CFG_KEY = "tabshelf.config";   // { url, key } del progetto Supabase
  const AUTH_KEY = "tabshelf.auth";    // sessione di Supabase Auth
  const SUPABASE_JS = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.119.0/dist/umd/supabase.js";

  let client = null, libPromise = null;

  function b64urlDecode(s) {
    s = s.replace(/-/g, "+").replace(/_/g, "/");
    while (s.length % 4) s += "=";
    return atob(s);
  }
  function jwtRole(key) {
    const p = key.split(".");
    if (p.length !== 3) return null;
    try { return JSON.parse(b64urlDecode(p[1])).role || null; } catch (e) { return null; }
  }

  /** Controlla e normalizza i dati del progetto. Lancia Error con messaggio in italiano. */
  function validateConfig(rawUrl, rawKey) {
    let url = String(rawUrl || "").trim().replace(/\/+$/, "");
    const key = String(rawKey || "").trim().replace(/\s+/g, "");
    if (!url) throw new Error("Inserisci il Project URL.");
    if (!/^https?:\/\//i.test(url)) url = "https://" + url;
    let parsed;
    try { parsed = new URL(url); } catch (e) { throw new Error("Il Project URL non è un indirizzo valido."); }
    if (parsed.protocol !== "https:") throw new Error("Il Project URL deve iniziare con https://");
    url = parsed.origin;
    if (!key) throw new Error("Inserisci la chiave pubblica.");
    if (/^sb_secret_/.test(key) || jwtRole(key) === "service_role")
      throw new Error("Questa è una chiave SEGRETA: non va mai usata qui. Copia la chiave pubblica (publishable / anon).");
    if (!/^sb_publishable_/.test(key) && jwtRole(key) !== "anon")
      throw new Error("La chiave non sembra quella pubblica: deve iniziare con \"sb_publishable_\" oppure essere la chiave \"anon\".");
    return { url, key };
  }

  /** Configurazione: prima quella ricordata nel browser, poi quella del file toolbox-config.js. */
  function loadConfig() {
    try {
      const c = JSON.parse(localStorage.getItem(CFG_KEY) || "null");
      if (c && c.url && c.key) return { url: c.url, key: c.key };
    } catch (e) {}
    const f = window.TOOLBOX_CONFIG || {};
    if (f.supabaseUrl && f.supabaseKey) {
      try { return validateConfig(f.supabaseUrl, f.supabaseKey); } catch (e) { return null; }
    }
    return null;
  }
  function saveConfig(cfg) { localStorage.setItem(CFG_KEY, JSON.stringify({ url: cfg.url, key: cfg.key })); }

  /** C'è una sessione salvata in questo browser? (controllo locale, senza rete) */
  function hasLocalSession() {
    try {
      const s = JSON.parse(localStorage.getItem(AUTH_KEY) || "null");
      return !!(s && (s.access_token || s.refresh_token));
    } catch (e) { return false; }
  }

  function loadLib() {
    if (window.supabase && window.supabase.createClient) return Promise.resolve();
    if (libPromise) return libPromise;
    libPromise = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = SUPABASE_JS; s.crossOrigin = "anonymous";
      s.onload = () => resolve();
      s.onerror = () => { libPromise = null; reject(new Error("Impossibile caricare la libreria di accesso: controlla la connessione.")); };
      document.head.appendChild(s);
    });
    return libPromise;
  }

  /** Client Supabase (null se manca la configurazione). */
  async function getClient() {
    if (client) return client;
    const cfg = loadConfig();
    if (!cfg) return null;
    await loadLib();
    client = window.supabase.createClient(cfg.url, cfg.key, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: AUTH_KEY }
    });
    return client;
  }

  async function getUser() {
    const c = await getClient();
    if (!c) return null;
    const { data } = await c.auth.getSession();
    return data.session ? data.session.user : null;
  }

  async function signIn(email, password) {
    const c = await getClient();
    if (!c) throw new Error("Collegamento a Supabase non configurato.");
    const { data, error } = await c.auth.signInWithPassword({ email: String(email).trim(), password });
    if (error) {
      if (/invalid login credentials/i.test(error.message || "")) throw new Error("Email o password non corretti.");
      throw new Error(error.message || "Accesso non riuscito.");
    }
    return data.user;
  }

  async function signOut() {
    try { const c = await getClient(); if (c) await c.auth.signOut({ scope: "local" }); } catch (e) {}
    try { localStorage.removeItem(AUTH_KEY); } catch (e) {}
  }

  /** Indirizzo della home, ricavato da dove è caricato questo script (funziona anche in sottocartella). */
  function homeUrl() {
    const me = document.querySelector('script[src*="toolbox-auth.js"]');
    return me ? me.src.replace(/assets\/js\/toolbox-auth\.js.*$/, "index.html") : "index.html";
  }

  window.Toolbox = { validateConfig, loadConfig, saveConfig, hasLocalSession, getClient, getUser, signIn, signOut, homeUrl };
})();
