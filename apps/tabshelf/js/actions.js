/**
 * actions.js — Tutte le modifiche ai dati (database + file), con aggiornamento dello stato in memoria.
 */
import { sb, rpc } from './sb.js';
import { state, emit, loadAll, activeTags } from './store.js';
import { removeFiles } from './storage.js';
import { norm } from './util.js';

const nowIso = () => new Date().toISOString();

function check({ data, error }) {
  if (error) throw error;
  return data;
}

function replaceIn(list, row) {
  const i = list.findIndex((x) => x.id === row.id);
  if (i >= 0) list[i] = row; else list.push(row);
}

/* ================================================================ CATEGORIE */

export async function createCategory(name) {
  const clean = String(name || '').trim();
  if (!clean) throw new Error('Scrivi un nome per la categoria.');
  const dup = state.categories.find((c) => !c.deleted_at && norm(c.name) === norm(clean));
  if (dup) throw new Error(`Esiste già la categoria «${dup.name}».`);
  const maxOrder = state.categories.reduce((m, c) => Math.max(m, c.sort_order || 0), 0);
  const row = check(await sb().from('categories').insert({ name: clean, sort_order: maxOrder + 10 }).select().single());
  state.categories.push(row);
  emit();
  return row;
}

export async function updateCategory(id, patch) {
  if (patch.name !== undefined) {
    patch.name = String(patch.name).trim();
    if (!patch.name) throw new Error('Il nome non può essere vuoto.');
    const dup = state.categories.find((c) => c.id !== id && !c.deleted_at && norm(c.name) === norm(patch.name));
    if (dup) throw new Error(`Esiste già la categoria «${dup.name}».`);
  }
  const row = check(await sb().from('categories').update(patch).eq('id', id).select().single());
  replaceIn(state.categories, row);
  emit();
  return row;
}

/** Salva un nuovo ordine (array di id). */
export async function reorderCategories(ids) {
  await Promise.all(ids.map((id, i) => sb().from('categories').update({ sort_order: (i + 1) * 10 }).eq('id', id).then(check)));
  ids.forEach((id, i) => { const c = state.categories.find((x) => x.id === id); if (c) c.sort_order = (i + 1) * 10; });
  emit();
}

export const trashCategory = (id) => updateCategory(id, { deleted_at: nowIso() });
export const restoreCategory = (id) => updateCategory(id, { deleted_at: null });

/** Eliminazione definitiva: spariscono anche i suoi tag e le loro associazioni. */
export async function purgeCategory(id) {
  check(await sb().from('categories').delete().eq('id', id));
  await loadAll();
}

/* ================================================================ TAG */

/** Tag attivo con questo nome nella categoria (senza distinguere maiuscole), se c'è. */
export function findTag(categoryId, name) {
  return activeTags().find((t) => t.category_id === categoryId && norm(t.name) === norm(name)) || null;
}

export async function createTag(categoryId, name, color = null) {
  const clean = String(name || '').trim();
  if (!clean) throw new Error('Scrivi un nome per il tag.');
  const dup = state.tags.find((t) => !t.deleted_at && t.category_id === categoryId && norm(t.name) === norm(clean));
  if (dup) throw new Error(`Esiste già il tag «${dup.name}» in questa categoria.`);
  const row = check(await sb().from('tags').insert({ category_id: categoryId, name: clean, color }).select().single());
  state.tags.push(row);
  emit();
  return row;
}

export async function updateTag(id, patch) {
  const tag = state.tags.find((t) => t.id === id);
  if (patch.name !== undefined) {
    patch.name = String(patch.name).trim();
    if (!patch.name) throw new Error('Il nome non può essere vuoto.');
    const catId = patch.category_id || tag?.category_id;
    const dup = state.tags.find((t) => t.id !== id && !t.deleted_at && t.category_id === catId && norm(t.name) === norm(patch.name));
    if (dup) throw new Error(`Esiste già il tag «${dup.name}» in questa categoria.`);
  }
  const row = check(await sb().from('tags').update(patch).eq('id', id).select().single());
  replaceIn(state.tags, row);
  emit();
  return row;
}

export const trashTag = (id) => updateTag(id, { deleted_at: nowIso() });
export const restoreTag = (id) => updateTag(id, { deleted_at: null });

/** Eliminazione definitiva (il database lo toglie anche dalle raccolte). */
export async function purgeTag(id) {
  check(await sb().from('tags').delete().eq('id', id));
  await loadAll();
}

/** Unisce source in target (operazione unica nel database). */
export async function mergeTags(sourceId, targetId) {
  await rpc('tabshelf_merge_tags', { source: sourceId, target: targetId });
  await loadAll();
}

/** Numero di documenti non eliminati che hanno un certo tag. */
export function tagUsage(tagId) {
  let n = 0;
  state.documents.forEach((d) => { if (!d.deleted_at && state.docTags.get(d.id)?.has(tagId)) n++; });
  return n;
}

/** Numero di documenti non eliminati che hanno almeno un tag della categoria. */
export function categoryUsage(categoryId) {
  const ids = new Set(state.tags.filter((t) => t.category_id === categoryId).map((t) => t.id));
  let n = 0;
  state.documents.forEach((d) => {
    if (d.deleted_at) return;
    const set = state.docTags.get(d.id);
    if (set && [...set].some((id) => ids.has(id))) n++;
  });
  return n;
}

/* ================================================================ DOCUMENTI */

/** Inserisce un documento già caricato nello storage, con i suoi tag. */
export async function insertDocument(row, tagIds = []) {
  const doc = check(await sb().from('documents').insert(row).select().single());
  state.documents.push(doc);
  if (tagIds.length) {
    check(await sb().from('document_tags').insert(tagIds.map((tag_id) => ({ document_id: doc.id, tag_id }))));
    state.docTags.set(doc.id, new Set(tagIds));
  }
  emit();
  return doc;
}

export async function updateDocuments(ids, patch) {
  if (!ids.length) return;
  const rows = [];
  for (let i = 0; i < ids.length; i += 200) {
    rows.push(...check(await sb().from('documents').update(patch).in('id', ids.slice(i, i + 200)).select()));
  }
  rows.forEach((r) => replaceIn(state.documents, r));
  emit();
}

export const updateDocument = (id, patch) => updateDocuments([id], patch);

/** Aggiunge dei tag a più documenti (senza duplicati). */
export async function addTags(docIds, tagIds) {
  const rows = [];
  docIds.forEach((document_id) => tagIds.forEach((tag_id) => {
    if (!state.docTags.get(document_id)?.has(tag_id)) rows.push({ document_id, tag_id });
  }));
  for (let i = 0; i < rows.length; i += 500) {
    check(await sb().from('document_tags').upsert(rows.slice(i, i + 500), { onConflict: 'document_id,tag_id', ignoreDuplicates: true }));
  }
  rows.forEach((r) => {
    if (!state.docTags.has(r.document_id)) state.docTags.set(r.document_id, new Set());
    state.docTags.get(r.document_id).add(r.tag_id);
  });
  emit();
}

/** Toglie dei tag da più documenti. */
export async function removeTags(docIds, tagIds) {
  if (!docIds.length || !tagIds.length) return;
  for (let i = 0; i < docIds.length; i += 200) {
    check(await sb().from('document_tags').delete().in('document_id', docIds.slice(i, i + 200)).in('tag_id', tagIds));
  }
  docIds.forEach((d) => tagIds.forEach((t) => state.docTags.get(d)?.delete(t)));
  emit();
}

/** Imposta esattamente i tag ATTIVI di un documento (quelli nel cestino restano com'erano). */
export async function setDocumentTags(docId, tagIds) {
  const active = new Set(activeTags().map((t) => t.id));
  const current = [...(state.docTags.get(docId) || [])].filter((id) => active.has(id));
  const want = new Set(tagIds);
  const toAdd = [...want].filter((id) => !current.includes(id));
  const toRemove = current.filter((id) => !want.has(id));
  if (toRemove.length) await removeTags([docId], toRemove);
  if (toAdd.length) await addTags([docId], toAdd);
}

export const trashDocuments = (ids) => updateDocuments(ids, { deleted_at: nowIso() });
export const restoreDocuments = (ids) => updateDocuments(ids, { deleted_at: null });

/** Eliminazione definitiva: prima i file, poi le righe. */
export async function purgeDocuments(ids) {
  const docs = state.documents.filter((d) => ids.includes(d.id));
  await removeFiles(docs.flatMap((d) => [d.file_path, d.thumb_path]));
  for (let i = 0; i < ids.length; i += 200) {
    check(await sb().from('documents').delete().in('id', ids.slice(i, i + 200)));
  }
  state.documents = state.documents.filter((d) => !ids.includes(d.id));
  ids.forEach((id) => state.docTags.delete(id));
  emit();
}

/** Svuota tutto il cestino (documenti, tag, categorie). */
export async function emptyTrash() {
  const docIds = state.documents.filter((d) => d.deleted_at).map((d) => d.id);
  if (docIds.length) await purgeDocuments(docIds);
  const tagIds = state.tags.filter((t) => t.deleted_at).map((t) => t.id);
  for (let i = 0; i < tagIds.length; i += 200) check(await sb().from('tags').delete().in('id', tagIds.slice(i, i + 200)));
  const catIds = state.categories.filter((c) => c.deleted_at).map((c) => c.id);
  for (let i = 0; i < catIds.length; i += 200) check(await sb().from('categories').delete().in('id', catIds.slice(i, i + 200)));
  await loadAll();
}

/* ================================================================ RACCOLTE */

export async function createCollection(name, filter) {
  const row = check(await sb().from('collections').insert({ name: String(name).trim(), filter }).select().single());
  state.collections.push(row);
  emit();
  return row;
}

export async function updateCollection(id, patch) {
  const row = check(await sb().from('collections').update(patch).eq('id', id).select().single());
  replaceIn(state.collections, row);
  emit();
  return row;
}

export async function deleteCollection(id) {
  check(await sb().from('collections').delete().eq('id', id));
  state.collections = state.collections.filter((c) => c.id !== id);
  emit();
}
