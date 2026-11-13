/**
 * store.js — Dati in memoria (categorie, tag, documenti, associazioni, raccolte).
 * Tutto viene caricato all'avvio e filtrato nel browser: per qualche centinaio
 * di documenti è più veloce e consuma meno traffico di tante piccole richieste.
 */
import { fetchAll } from './sb.js';

export const state = {
  loaded: false,
  categories: [],             // tutte, comprese quelle nel cestino
  tags: [],                   // tutti, compresi quelli nel cestino
  documents: [],              // tutti, compresi quelli nel cestino
  docTags: new Map(),         // document_id -> Set(tag_id)
  collections: [],
};

const listeners = new Set();
/** Registra una funzione chiamata a ogni cambiamento dei dati. Restituisce la funzione per annullare. */
export function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function emit() { listeners.forEach((fn) => { try { fn(); } catch (e) { console.error(e); } }); }

/** Carica (o ricarica) tutto dal database. */
export async function loadAll() {
  const [categories, tags, documents, links, collections] = await Promise.all([
    fetchAll('categories'),
    fetchAll('tags'),
    fetchAll('documents'),
    fetchAll('document_tags', 'document_id,tag_id', { order: 'created_at' }),
    fetchAll('collections'),
  ]);
  state.categories = categories;
  state.tags = tags;
  state.documents = documents;
  state.collections = collections;
  state.docTags = new Map();
  links.forEach((l) => {
    if (!state.docTags.has(l.document_id)) state.docTags.set(l.document_id, new Set());
    state.docTags.get(l.document_id).add(l.tag_id);
  });
  state.loaded = true;
  emit();
}

/* ----------------------------------------------------------------- viste derivate */

/** Categorie non eliminate, in ordine. */
export function activeCategories() {
  return state.categories
    .filter((c) => !c.deleted_at)
    .sort((a, b) => (a.sort_order - b.sort_order) || a.name.localeCompare(b.name, 'it'));
}

/** Set degli id delle categorie attive. */
function activeCategoryIds() {
  return new Set(state.categories.filter((c) => !c.deleted_at).map((c) => c.id));
}

/** Tag attivi: non eliminati e con categoria non eliminata. */
export function activeTags() {
  const cats = activeCategoryIds();
  return state.tags.filter((t) => !t.deleted_at && cats.has(t.category_id));
}

/** Set degli id dei tag attivi. */
export function activeTagIds() {
  return new Set(activeTags().map((t) => t.id));
}

/** Documenti non eliminati. */
export function activeDocuments() {
  return state.documents.filter((d) => !d.deleted_at);
}

/** Tag attivi di un documento (array di id). */
export function docActiveTagIds(docId, active = activeTagIds()) {
  const set = state.docTags.get(docId);
  if (!set) return [];
  return [...set].filter((id) => active.has(id));
}

/** Documenti "da classificare": non eliminati e senza alcun tag attivo. */
export function unclassifiedDocuments() {
  const active = activeTagIds();
  return activeDocuments().filter((d) => docActiveTagIds(d.id, active).length === 0);
}

/** Spazio occupato (byte): totale e solo cestino. */
export function spaceUsage() {
  let total = 0; let trash = 0;
  state.documents.forEach((d) => {
    const s = (Number(d.file_size) || 0) + (Number(d.thumb_size) || 0);
    total += s;
    if (d.deleted_at) trash += s;
  });
  return { total, trash };
}
