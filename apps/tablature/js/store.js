/**
 * store.js — Stato in memoria + operazioni sui dati (logica di dominio).
 *
 * I metadati di tablature e categorie vengono caricati interamente in memoria
 * (sono leggeri anche con migliaia di elementi). I blob delle immagini restano in
 * IndexedDB e vengono letti on-demand tramite getImageURL().
 * Ogni modifica viene scritta PRIMA su IndexedDB e solo dopo applicata alla memoria:
 * se la scrittura fallisce, lo stato visualizzato resta coerente con il database.
 */
import * as db from './db.js';
import { uid, MAX_CATEGORY_LEVEL, collator, UserError } from './utils.js';

export const state = {
  tabs: new Map(),        // id -> tab
  categories: new Map(),  // id -> category
  settings: {},           // key -> value
};

/** Impostazioni predefinite. */
export const DEFAULT_SETTINGS = {
  theme: 'auto',              // auto | light | dark
  viewMode: 'grid',           // grid | list
  sortBy: 'createdAt-desc',
  backupReminderDays: 30,     // 0 = disattivato
  lastBackupAt: null,
  firstUseAt: null,
  reminderSnoozedUntil: null,
  keepLastValues: true,       // inserimento consecutivo: mantiene categoria/CAGED/tonalità
  keepOriginalFile: false,    // conserva anche il file originale (occupa più spazio)
  includeSubcategories: true, // aprendo una categoria mostra anche le sottocategorie
  schemaVersion: db.DATA_SCHEMA_VERSION,
};

/* ------------------------------------------------------------------ eventi */
const listeners = new Set();
export function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function emitChange(reason = 'data') { listeners.forEach((fn) => { try { fn(reason); } catch (e) { console.error(e); } }); }

/* ---------------------------------------------------------------- caricamento */
export async function loadAll() {
  const [tabs, cats, settings] = await Promise.all([db.getAll('tabs'), db.getAll('categories'), db.getAll('settings')]);
  state.tabs = new Map();
  for (const t of tabs) {
    // Un record danneggiato non deve bloccare l'app: lo normalizziamo o lo saltiamo.
    try { state.tabs.set(t.id, normalizeTab(t)); } catch (e) { console.warn('Tablatura ignorata (record non valido):', t, e); }
  }
  state.categories = new Map();
  for (const c of cats) {
    if (c && c.id && typeof c.name === 'string') state.categories.set(c.id, normalizeCategory(c));
  }
  // Riparazione della gerarchia (padri mancanti, cicli, livelli oltre il limite).
  const repaired = repairHierarchy();
  if (repaired.length) await db.batch([{ store: 'categories', put: repaired }]);
  state.settings = { ...DEFAULT_SETTINGS };
  for (const s of settings) state.settings[s.key] = s.value;
  if (!state.settings.firstUseAt) await setSetting('firstUseAt', new Date().toISOString());
}

/** Garantisce che una tablatura abbia tutti i campi previsti dallo schema. */
export function normalizeTab(t) {
  if (!t || !t.id || !t.imageId) throw new Error('record incompleto');
  return {
    id: t.id,
    title: t.title || '',
    description: t.description || '',
    notes: t.notes || '',
    imageId: t.imageId,
    thumbId: t.thumbId || t.imageId,
    originalId: t.originalId || null,
    originalName: t.originalName || '',
    imgWidth: t.imgWidth || 0,
    imgHeight: t.imgHeight || 0,
    imageMime: t.imageMime || 'image/jpeg',
    imageSize: t.imageSize || 0,
    createdAt: t.createdAt || new Date().toISOString(),
    updatedAt: t.updatedAt || t.createdAt || new Date().toISOString(),
    categoryIds: Array.isArray(t.categoryIds) ? t.categoryIds.slice() : [],
    caged: Array.isArray(t.caged) ? t.caged.slice() : [],
    cagedOrdered: !!t.cagedOrdered,
    keys: Array.isArray(t.keys) ? t.keys.slice() : [],
    customKey: t.customKey || '',
    favorite: !!t.favorite,
    order: Number.isFinite(t.order) ? t.order : Date.parse(t.createdAt || '') || Date.now(),
    orientation: t.orientation || 'auto',     // auto | portrait | landscape (indicazione per il PDF)
    pdf: { exclude: !!(t.pdf && t.pdf.exclude), ownPage: !!(t.pdf && t.pdf.ownPage) },
    isDemo: !!t.isDemo,
  };
}

export function normalizeCategory(c) {
  return {
    id: c.id,
    name: c.name,
    description: c.description || '',
    parentId: c.parentId || null,
    level: c.level || 1,
    order: Number.isFinite(c.order) ? c.order : 0,
    createdAt: c.createdAt || new Date().toISOString(),
    color: c.color || '',
    icon: c.icon || '',
    isDemo: !!c.isDemo,
  };
}

/* ------------------------------------------------------------ impostazioni */
export async function setSetting(key, value) {
  await db.setSetting(key, value);
  state.settings[key] = value;
}

/* =================================================================== CATEGORIE */

/** Figli diretti ordinati. parentId null = radice. */
export function childrenOf(parentId) {
  return [...state.categories.values()]
    .filter((c) => (c.parentId || null) === (parentId || null))
    .sort((a, b) => a.order - b.order || collator.compare(a.name, b.name));
}

/** Tutti i discendenti (id) di una categoria, esclusa la categoria stessa. */
export function descendantIds(id) {
  const out = [];
  const walk = (pid) => childrenOf(pid).forEach((c) => { out.push(c.id); walk(c.id); });
  walk(id);
  return out;
}

/** Profondità del sottoalbero (1 = solo la categoria). */
export function subtreeDepth(id) {
  const kids = childrenOf(id);
  return 1 + (kids.length ? Math.max(...kids.map((k) => subtreeDepth(k.id))) : 0);
}

/** Antenati dalla radice alla categoria inclusa. */
export function ancestry(id) {
  const chain = [];
  let cur = state.categories.get(id);
  const guard = new Set();
  while (cur && !guard.has(cur.id)) { guard.add(cur.id); chain.unshift(cur); cur = cur.parentId ? state.categories.get(cur.parentId) : null; }
  return chain;
}

/** Percorso testuale, es. "Lick › Pentatonica › G-Shape". */
export function categoryPath(id, sep = ' › ') {
  return ancestry(id).map((c) => c.name).join(sep);
}

/** Elenco piatto in ordine ad albero (DFS) con livello. */
export function flatTree() {
  const out = [];
  const walk = (pid) => childrenOf(pid).forEach((c) => { out.push(c); walk(c.id); });
  walk(null);
  return out;
}

/**
 * Ripara la gerarchia (padri mancanti, cicli, profondità oltre il limite).
 * Utile dopo importazioni/unioni o con dati danneggiati. Restituisce le categorie modificate.
 */
export function repairHierarchy() {
  const changed = new Set();
  const before = new Map([...state.categories.values()].map((c) => [c.id, c.level]));
  for (const c of state.categories.values()) {
    if (c.parentId && !state.categories.has(c.parentId)) { c.parentId = null; changed.add(c); }
    // Rilevamento cicli
    const seen = new Set([c.id]);
    let p = c.parentId ? state.categories.get(c.parentId) : null;
    while (p) {
      if (seen.has(p.id)) { c.parentId = null; changed.add(c); break; }
      seen.add(p.id);
      p = p.parentId ? state.categories.get(p.parentId) : null;
    }
  }
  recomputeLevels();
  // Profondità: i nodi oltre il limite vengono agganciati all'antenato di livello MAX-1.
  for (const c of flatTree()) {
    if (c.level > MAX_CATEGORY_LEVEL) {
      const anc = ancestry(c.id);
      c.parentId = anc[MAX_CATEGORY_LEVEL - 2].id;
      changed.add(c);
      recomputeLevels();
    }
  }
  for (const c of state.categories.values()) { if (before.get(c.id) !== c.level) changed.add(c); }
  return [...changed];
}

/** Ricalcola i livelli a partire dalla gerarchia (fonte di verità = parentId). */
function recomputeLevels() {
  const walk = (pid, lvl) => childrenOf(pid).forEach((c) => { c.level = lvl; walk(c.id, lvl + 1); });
  walk(null, 1);
}

/** Conteggio tablature: dirette e totali (incluse sottocategorie, senza doppioni). */
export function categoryCounts() {
  const direct = new Map();
  for (const t of state.tabs.values()) for (const cid of t.categoryIds) direct.set(cid, (direct.get(cid) || 0) + 1);
  const total = new Map();
  for (const c of state.categories.values()) {
    const ids = new Set([c.id, ...descendantIds(c.id)]);
    let n = 0;
    for (const t of state.tabs.values()) if (t.categoryIds.some((x) => ids.has(x))) n++;
    total.set(c.id, n);
  }
  return { direct, total };
}

/** Verifica se una categoria può essere spostata sotto newParentId. */
export function canMoveCategory(id, newParentId) {
  if (!newParentId) return { ok: true };
  if (newParentId === id) return { ok: false, reason: 'Una categoria non può essere figlia di sé stessa.' };
  if (descendantIds(id).includes(newParentId)) return { ok: false, reason: 'Non puoi spostare una categoria dentro una sua sottocategoria.' };
  const parent = state.categories.get(newParentId);
  if (!parent) return { ok: false, reason: 'Categoria padre inesistente.' };
  const depth = id ? subtreeDepth(id) : 1;
  if (parent.level + depth > MAX_CATEGORY_LEVEL) {
    return { ok: false, reason: `Superato il limite di ${MAX_CATEGORY_LEVEL} livelli.` };
  }
  return { ok: true };
}

/** Crea una nuova categoria. */
export async function createCategory({ name, description = '', parentId = null, color = '', icon = '' }) {
  name = String(name || '').trim();
  if (!name) throw new UserError('Il nome della categoria è obbligatorio.');
  if (parentId) {
    const p = state.categories.get(parentId);
    if (!p) throw new UserError('Categoria padre inesistente.');
    if (p.level >= MAX_CATEGORY_LEVEL) throw new UserError(`Impossibile creare la sottocategoria: il limite è di ${MAX_CATEGORY_LEVEL} livelli.`);
  }
  const siblings = childrenOf(parentId);
  const cat = normalizeCategory({
    id: uid(), name, description, parentId, color, icon,
    level: parentId ? state.categories.get(parentId).level + 1 : 1,
    order: siblings.length ? Math.max(...siblings.map((s) => s.order)) + 1 : 0,
    createdAt: new Date().toISOString(),
  });
  await db.put('categories', cat);
  state.categories.set(cat.id, cat);
  emitChange('categories');
  return cat;
}

/** Aggiorna nome/descrizione/colore/icona e (eventualmente) il padre. */
export async function updateCategory(id, patch) {
  const cur = state.categories.get(id);
  if (!cur) throw new UserError('Categoria non trovata.');
  const next = { ...cur, ...patch };
  next.name = String(next.name || '').trim();
  if (!next.name) throw new UserError('Il nome della categoria è obbligatorio.');
  const parentChanged = (patch.parentId !== undefined) && (patch.parentId || null) !== (cur.parentId || null);
  if (parentChanged) {
    const chk = canMoveCategory(id, patch.parentId || null);
    if (!chk.ok) throw new UserError(chk.reason);
    const siblings = childrenOf(patch.parentId || null);
    next.order = siblings.length ? Math.max(...siblings.map((s) => s.order)) + 1 : 0;
  }
  next.parentId = next.parentId || null;
  // Applico in una copia per calcolare i nuovi livelli di tutto il sottoalbero.
  const backup = new Map([...state.categories].map(([k, v]) => [k, { ...v }]));
  state.categories.set(id, next);
  recomputeLevels();
  const affected = [id, ...descendantIds(id)].map((cid) => state.categories.get(cid));
  try {
    await db.batch([{ store: 'categories', put: affected }]);
  } catch (e) { state.categories = backup; throw e; }
  emitChange('categories');
}

/** Riordina i fratelli: sposta la categoria id prima di beforeId (o in fondo se null). */
export async function reorderCategory(id, beforeId) {
  const cat = state.categories.get(id);
  if (!cat) return;
  const siblings = childrenOf(cat.parentId).filter((c) => c.id !== id);
  const idx = beforeId ? siblings.findIndex((c) => c.id === beforeId) : -1;
  if (idx >= 0) siblings.splice(idx, 0, cat); else siblings.push(cat);
  siblings.forEach((c, i) => { c.order = i; });
  await db.batch([{ store: 'categories', put: siblings }]);
  emitChange('categories');
}

/** Sposta su/giù tra i fratelli. */
export async function moveCategoryStep(id, delta) {
  const cat = state.categories.get(id);
  const siblings = childrenOf(cat.parentId);
  const i = siblings.findIndex((c) => c.id === id);
  const j = i + delta;
  if (j < 0 || j >= siblings.length) return;
  [siblings[i], siblings[j]] = [siblings[j], siblings[i]];
  siblings.forEach((c, k) => { c.order = k; });
  await db.batch([{ store: 'categories', put: siblings }]);
  emitChange('categories');
}

/**
 * Elimina una categoria.
 * mode: 'unlink' (rimuove solo l'associazione) | 'move' (sposta le tablature in targetId)
 * Le sottocategorie vengono promosse al padre della categoria eliminata.
 */
export async function deleteCategory(id, mode = 'unlink', targetId = null) {
  const cat = state.categories.get(id);
  if (!cat) return;
  if (mode === 'move' && (!targetId || targetId === id || !state.categories.has(targetId))) throw new UserError('Seleziona una categoria di destinazione valida.');
  const changedTabs = [];
  const now = new Date().toISOString();
  for (const t of state.tabs.values()) {
    if (!t.categoryIds.includes(id)) continue;
    let ids = t.categoryIds.filter((x) => x !== id);
    if (mode === 'move' && !ids.includes(targetId)) ids.push(targetId);
    changedTabs.push({ ...t, categoryIds: ids, updatedAt: now });
  }
  const kids = childrenOf(id).map((k) => ({ ...k, parentId: cat.parentId || null }));
  await db.batch([
    { store: 'tabs', put: changedTabs },
    { store: 'categories', put: kids, del: [id] },
  ]);
  changedTabs.forEach((t) => state.tabs.set(t.id, t));
  kids.forEach((k) => state.categories.set(k.id, k));
  state.categories.delete(id);
  recomputeLevels();
  await db.batch([{ store: 'categories', put: [...state.categories.values()] }]);
  emitChange('categories');
  return changedTabs.length;
}

/**
 * Unisce sourceId dentro targetId: le tablature passano a target, le sottocategorie
 * di source diventano figlie di target (se il limite di livelli lo consente), poi source viene eliminata.
 */
export async function mergeCategories(sourceId, targetId) {
  if (sourceId === targetId) throw new UserError('Seleziona due categorie diverse.');
  const src = state.categories.get(sourceId);
  const dst = state.categories.get(targetId);
  if (!src || !dst) throw new UserError('Categoria non trovata.');
  if (descendantIds(sourceId).includes(targetId)) throw new UserError('Non puoi unire una categoria in una sua sottocategoria.');
  const kids = childrenOf(sourceId);
  for (const k of kids) {
    if (dst.level + subtreeDepth(k.id) > MAX_CATEGORY_LEVEL) {
      throw new UserError(`Impossibile unire: le sottocategorie di "${src.name}" supererebbero il limite di ${MAX_CATEGORY_LEVEL} livelli.`);
    }
  }
  const now = new Date().toISOString();
  const changedTabs = [];
  for (const t of state.tabs.values()) {
    if (!t.categoryIds.includes(sourceId)) continue;
    const ids = t.categoryIds.filter((x) => x !== sourceId);
    if (!ids.includes(targetId)) ids.push(targetId);
    changedTabs.push({ ...t, categoryIds: ids, updatedAt: now });
  }
  const baseOrder = childrenOf(targetId).length;
  const movedKids = kids.map((k, i) => ({ ...k, parentId: targetId, order: baseOrder + i }));
  await db.batch([
    { store: 'tabs', put: changedTabs },
    { store: 'categories', put: movedKids, del: [sourceId] },
  ]);
  changedTabs.forEach((t) => state.tabs.set(t.id, t));
  movedKids.forEach((k) => state.categories.set(k.id, k));
  state.categories.delete(sourceId);
  recomputeLevels();
  await db.batch([{ store: 'categories', put: [...state.categories.values()] }]);
  emitChange('categories');
}

/* ================================================================== TABLATURE */

/** Crea una tablatura con le relative immagini (transazione unica). */
export async function createTab(meta, images) {
  const now = new Date().toISOString();
  const id = uid();
  const imageId = uid();
  const thumbId = uid();
  const records = [
    { id: imageId, tabId: id, kind: 'full', blob: images.full.blob, mime: images.full.blob.type, width: images.full.width, height: images.full.height, size: images.full.blob.size },
    { id: thumbId, tabId: id, kind: 'thumb', blob: images.thumb.blob, mime: images.thumb.blob.type, width: images.thumb.width, height: images.thumb.height, size: images.thumb.blob.size },
  ];
  let originalId = images.originalRefId || null; // file originale già salvato e condiviso (es. stesso PDF)
  if (images.original && !originalId) {
    originalId = uid();
    records.push({ id: originalId, tabId: id, kind: 'original', blob: images.original, mime: images.original.type, size: images.original.size, name: images.originalName || '' });
  }
  const maxOrder = Math.max(0, ...[...state.tabs.values()].map((t) => t.order || 0));
  const tab = normalizeTab({
    ...meta, id, imageId, thumbId, originalId,
    originalName: images.originalName || '',
    imgWidth: images.full.width, imgHeight: images.full.height,
    imageMime: images.full.blob.type, imageSize: images.full.blob.size,
    createdAt: now, updatedAt: now, order: maxOrder + 1,
  });
  await db.batch([{ store: 'images', put: records }, { store: 'tabs', put: [tab] }]);
  state.tabs.set(tab.id, tab);
  emitChange('tabs');
  return tab;
}

/** Aggiorna i metadati e (opzionale) sostituisce l'immagine. */
export async function updateTab(id, patch, newImages = null) {
  const cur = state.tabs.get(id);
  if (!cur) throw new UserError('Tablatura non trovata.');
  const next = normalizeTab({ ...cur, ...patch, updatedAt: new Date().toISOString() });
  const ops = [];
  if (newImages) {
    const imageId = uid(); const thumbId = uid();
    ops.push({ store: 'images', put: [
      { id: imageId, tabId: id, kind: 'full', blob: newImages.full.blob, mime: newImages.full.blob.type, width: newImages.full.width, height: newImages.full.height, size: newImages.full.blob.size },
      { id: thumbId, tabId: id, kind: 'thumb', blob: newImages.thumb.blob, mime: newImages.thumb.blob.type, width: newImages.thumb.width, height: newImages.thumb.height, size: newImages.thumb.blob.size },
    ], del: [cur.imageId, cur.thumbId].filter((x) => x && x !== cur.originalId) });
    Object.assign(next, { imageId, thumbId, imgWidth: newImages.full.width, imgHeight: newImages.full.height, imageMime: newImages.full.blob.type, imageSize: newImages.full.blob.size });
    if (newImages.original) {
      const originalId = uid();
      ops[0].put.push({ id: originalId, tabId: id, kind: 'original', blob: newImages.original, mime: newImages.original.type, size: newImages.original.size, name: newImages.originalName || '' });
      if (cur.originalId && !isOriginalShared(cur.originalId, id)) ops[0].del.push(cur.originalId);
      next.originalId = originalId; next.originalName = newImages.originalName || '';
    }
    revokeURL(cur.imageId); revokeURL(cur.thumbId);
  }
  ops.push({ store: 'tabs', put: [next] });
  await db.batch(ops);
  state.tabs.set(id, next);
  emitChange('tabs');
  return next;
}

/** Aggiornamento di gruppo dei soli metadati. fn(tab) restituisce la patch. */
export async function bulkUpdate(ids, fn) {
  const now = new Date().toISOString();
  const changed = ids.map((id) => state.tabs.get(id)).filter(Boolean)
    .map((t) => normalizeTab({ ...t, ...fn(t), updatedAt: now }));
  await db.batch([{ store: 'tabs', put: changed }]);
  changed.forEach((t) => state.tabs.set(t.id, t));
  emitChange('tabs');
  return changed.length;
}

/** Verifica se il file originale è condiviso con altre tablature (es. stesse pagine PDF). */
function isOriginalShared(originalId, exceptTabId) {
  return [...state.tabs.values()].some((t) => t.id !== exceptTabId && t.originalId === originalId);
}

/** Duplica una tablatura (le immagini vengono copiate). */
export async function duplicateTab(id) {
  const cur = state.tabs.get(id);
  const imgs = await db.getImagesByTab(id);
  const full = imgs.find((i) => i.id === cur.imageId);
  const thumb = imgs.find((i) => i.id === cur.thumbId);
  if (!full) throw new UserError('Immagine della tablatura non trovata.');
  return createTab({ ...cur, title: cur.title ? `${cur.title} (copia)` : '', isDemo: cur.isDemo }, {
    full: { blob: full.blob, width: full.width, height: full.height },
    thumb: thumb ? { blob: thumb.blob, width: thumb.width, height: thumb.height } : { blob: full.blob, width: full.width, height: full.height },
  });
}

/**
 * Elimina tablature. Restituisce uno snapshot da passare a restoreDeleted()
 * per il comando "Annulla".
 */
export async function deleteTabs(ids) {
  const snapshot = { tabs: [], images: [] };
  const imageDel = [];
  const idSet = new Set(ids);
  for (const id of ids) {
    const t = state.tabs.get(id);
    if (!t) continue;
    snapshot.tabs.push(t);
    const imgs = await db.getImagesByTab(id);
    // Il file originale può appartenere (tabId) a un'altra tablatura già eliminata: lo includo esplicitamente.
    if (t.originalId && !imgs.some((i) => i.id === t.originalId)) {
      const orig = await db.get('images', t.originalId);
      if (orig) imgs.push(orig);
    }
    for (const img of imgs) {
      if (imageDel.includes(img.id)) continue;
      // Il file originale condiviso con tablature non eliminate resta.
      if (img.kind === 'original' && [...state.tabs.values()].some((o) => !idSet.has(o.id) && o.originalId === img.id)) continue;
      snapshot.images.push(img); imageDel.push(img.id);
    }
  }
  await db.batch([{ store: 'tabs', del: snapshot.tabs.map((t) => t.id) }, { store: 'images', del: imageDel }]);
  snapshot.tabs.forEach((t) => { state.tabs.delete(t.id); revokeURL(t.imageId); revokeURL(t.thumbId); });
  emitChange('tabs');
  return snapshot;
}

/** Ripristina uno snapshot di eliminazione. */
export async function restoreDeleted(snapshot) {
  await db.batch([{ store: 'images', put: snapshot.images }, { store: 'tabs', put: snapshot.tabs }]);
  snapshot.tabs.forEach((t) => state.tabs.set(t.id, t));
  emitChange('tabs');
}

/**
 * Ordine manuale: sposta la tablatura id di delta posizioni all'interno della lista
 * visualizzata e rinumera l'intera lista (robusto anche con valori di ordine duplicati).
 */
export async function moveInOrder(listIds, id, delta) {
  const ids = listIds.slice();
  const i = ids.indexOf(id); const j = i + delta;
  if (i < 0 || j < 0 || j >= ids.length) return;
  [ids[i], ids[j]] = [ids[j], ids[i]];
  const changed = ids.map((tid, k) => ({ ...state.tabs.get(tid), order: (k + 1) * 10 }));
  await db.batch([{ store: 'tabs', put: changed }]);
  changed.forEach((t) => state.tabs.set(t.id, t));
  emitChange('tabs');
}

/* ========================================================== URL DELLE IMMAGINI */
const urlCache = new Map(); // imageId -> objectURL

/** Restituisce un objectURL per un'immagine (con cache). */
export async function getImageURL(imageId) {
  if (urlCache.has(imageId)) return urlCache.get(imageId);
  const rec = await db.get('images', imageId);
  if (!rec || !rec.blob) throw new Error('Immagine mancante o danneggiata.');
  const url = URL.createObjectURL(rec.blob);
  urlCache.set(imageId, url);
  return url;
}

/** Restituisce il blob di un'immagine. */
export async function getImageBlob(imageId) {
  const rec = await db.get('images', imageId);
  if (!rec || !rec.blob) throw new Error('Immagine mancante o danneggiata.');
  return rec;
}

export function revokeURL(imageId) {
  const u = urlCache.get(imageId);
  if (u) { URL.revokeObjectURL(u); urlCache.delete(imageId); }
}

/** Libera le immagini grandi in cache (le miniature restano). */
export function releaseFullImages() {
  const thumbIds = new Set([...state.tabs.values()].map((t) => t.thumbId));
  for (const id of [...urlCache.keys()]) if (!thumbIds.has(id)) revokeURL(id);
}

export function resetURLCache() { for (const id of [...urlCache.keys()]) revokeURL(id); }
