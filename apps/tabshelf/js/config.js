/**
 * config.js — Tutte le impostazioni di TabShelf in un unico posto.
 * NON contiene (e non deve mai contenere) URL, chiavi o credenziali di Supabase:
 * quelle vengono incollate nell'app al primo avvio e salvate solo nel browser.
 */

/** Versione dell'app (mostrata nelle impostazioni). */
export const APP_VERSION = '0.1.0';

/** Versione dello schema del database: deve coincidere con tabshelf_schema_version() in supabase/setup.sql. */
export const SCHEMA_VERSION = 1;

/** Nome del bucket privato di Supabase Storage. */
export const BUCKET = 'tabshelf';

/** Soglie per gli avvisi sullo spazio occupato. */
export const SPACE = {
  /** Avviso quando i documenti nel cestino superano questa dimensione. */
  trashWarnBytes: 100 * 1024 * 1024,           // 100 MB
  /** Spazio file disponibile nel piano gratuito di Supabase. */
  quotaBytes: 1024 * 1024 * 1024,              // 1 GB
  /** Avviso quando il totale supera questa frazione della quota. */
  quotaWarnRatio: 0.8,                         // 80%
  /** Avviso al caricamento di PDF più grandi di così. */
  pdfWarnBytes: 5 * 1024 * 1024,               // 5 MB
};

/** Elaborazione delle immagini prima dell'invio. */
export const IMAGES = {
  maxSide: 2200,       // lato lungo massimo dell'immagine
  quality: 0.85,       // qualità WebP
  thumbSide: 400,      // lato lungo della miniatura
  thumbQuality: 0.8,
};

/** Durata degli URL firmati (secondi) e margine di rinnovo anticipato. */
export const SIGNED_URL = { ttl: 3600, renewBeforeSec: 300, batchSize: 100 };

/** Nomi usati nel browser (localStorage / Cache API). */
export const KEYS = {
  config: 'tabshelf.config',        // { url, key } del progetto Supabase
  auth: 'tabshelf.auth',            // sessione di Supabase Auth
  prefs: 'tabshelf.prefs',          // preferenze dell'interfaccia
  thumbCache: 'tabshelf-thumbs-v1', // cache locale delle miniature (Cache API)
};

/** Librerie esterne con versione bloccata (jsDelivr). supabase-js è caricata da index.html. */
export const LIBS = {
  pdfjs: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.5.438/build/pdf.min.mjs',
  pdfWorker: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.5.438/build/pdf.worker.min.mjs',
  jszip: 'https://cdn.jsdelivr.net/npm/jszip@3.10.2/dist/jszip.min.js',
  qrcode: 'https://cdn.jsdelivr.net/npm/qrcode-generator@2.0.4/dist/qrcode.mjs',
};

/** Stati di studio di un documento. */
export const STATUSES = [
  { id: 'da_fare', label: 'Da fare' },
  { id: 'in_corso', label: 'In corso' },
  { id: 'completo', label: 'Completo' },
];

/** Tavolozza proposta per i colori dei tag. */
export const TAG_PALETTE = [
  '#c2632b', '#d9822b', '#c9a227', '#6b8e23', '#2f7d4f', '#2f6f62',
  '#2c7fb8', '#3b6fd1', '#5b4fc4', '#8a3fb8', '#b83f8a', '#c0392b',
  '#7a5c45', '#5d6470',
];
