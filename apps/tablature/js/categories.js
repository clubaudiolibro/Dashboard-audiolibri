/**
 * categories.js — Interfaccia di gestione delle categorie:
 * albero (navigazione e gestione), form di creazione/modifica, eliminazione,
 * unione, riordino (pulsanti + drag & drop su desktop) e selettore multiplo per i form.
 */
import * as S from './store.js';
import { esc, html, MAX_CATEGORY_LEVEL } from './utils.js';
import { openModal, toast, guard, choiceDialog } from './ui.js';

/** Rami compressi (per default tutto è espanso). */
const collapsed = new Set();

/* ------------------------------------------------------------ helper select */

/**
 * Opzioni <select> con rientri gerarchici.
 * opts: { selected, excludeSubtreeOf, forParentOf (id categoria da spostare: filtra padri validi), rootLabel, onlyParents }
 */
export function categoryOptions({ selected = '', excludeSubtreeOf = null, forParentOf = undefined, rootLabel = null, onlyParents = false } = {}) {
  const excluded = new Set(excludeSubtreeOf ? [excludeSubtreeOf, ...S.descendantIds(excludeSubtreeOf)] : []);
  let out = rootLabel !== null ? `<option value="">${esc(rootLabel)}</option>` : '';
  for (const c of S.flatTree()) {
    if (excluded.has(c.id)) continue;
    let disabled = false;
    if (onlyParents && c.level >= MAX_CATEGORY_LEVEL) disabled = true;
    if (forParentOf !== undefined && !S.canMoveCategory(forParentOf, c.id).ok) disabled = true;
    const pad = '\u00A0\u00A0\u00A0'.repeat(c.level - 1);
    out += `<option value="${esc(c.id)}" ${c.id === selected ? 'selected' : ''} ${disabled ? 'disabled' : ''}>${pad}${esc(c.icon ? c.icon + ' ' : '')}${esc(c.name)}</option>`;
  }
  return out;
}

/* ----------------------------------------------------------- form categoria */

/**
 * Apre il form di creazione/modifica. Restituisce Promise<categoria|null>.
 * opts: { id (modifica), parentId (creazione) }
 */
export function openCategoryForm({ id = null, parentId = null } = {}) {
  const cat = id ? S.state.categories.get(id) : null;
  return new Promise((resolve) => {
    const body = html(`<form class="form" novalidate>
      <label class="field"><span>Nome *</span><input name="name" required maxlength="80" value="${esc(cat ? cat.name : '')}" autofocus></label>
      <label class="field"><span>Descrizione</span><input name="description" maxlength="200" value="${esc(cat ? cat.description : '')}"></label>
      <label class="field"><span>Categoria padre</span>
        <select name="parentId">${categoryOptions({ selected: cat ? (cat.parentId || '') : (parentId || ''), rootLabel: '— Nessuna (primo livello) —', excludeSubtreeOf: id, forParentOf: id || null, onlyParents: !id })}</select>
        <small class="muted">Massimo ${MAX_CATEGORY_LEVEL} livelli. Le voci disattivate supererebbero il limite.</small></label>
      <div class="field-row">
        <label class="field"><span>Colore</span><input type="color" name="color" value="${esc((cat && cat.color) || '#4f7cff')}"></label>
        <label class="field"><span>Icona (emoji, facoltativa)</span><input name="icon" maxlength="4" value="${esc(cat ? cat.icon : '')}" placeholder="🎸"></label>
        <label class="check"><input type="checkbox" name="nocolor" ${cat && !cat.color ? 'checked' : (!cat ? 'checked' : '')}> Nessun colore</label>
      </div>
      <p class="form-error" role="alert" hidden></p>
    </form>`);
    const footer = html(`<div class="btn-row"><button type="button" class="btn" data-a="cancel">Annulla</button>
      <button type="button" class="btn primary" data-a="save">${id ? 'Salva' : 'Crea categoria'}</button></div>`);
    const m = openModal({ title: id ? 'Modifica categoria' : 'Nuova categoria', size: 'sm', body, footer, onClose: (r) => resolve(r || null) });
    const save = async () => {
      const f = new FormData(body);
      const data = {
        name: String(f.get('name') || '').trim(),
        description: String(f.get('description') || '').trim(),
        parentId: f.get('parentId') || null,
        color: f.get('nocolor') ? '' : f.get('color'),
        icon: String(f.get('icon') || '').trim(),
      };
      const err = body.querySelector('.form-error');
      try {
        let res;
        if (id) { await S.updateCategory(id, data); res = S.state.categories.get(id); } else { res = await S.createCategory(data); }
        toast(id ? 'Categoria aggiornata.' : `Categoria "${res.name}" creata.`, { type: 'success' });
        m.close(res);
      } catch (e) { err.textContent = e.userMessage || e.message; err.hidden = false; }
    };
    footer.querySelector('[data-a=cancel]').onclick = () => m.close(null);
    footer.querySelector('[data-a=save]').onclick = save;
    body.addEventListener('submit', (e) => { e.preventDefault(); save(); });
  });
}

/* ------------------------------------------------------------ eliminazione */

export async function deleteCategoryFlow(id) {
  const cat = S.state.categories.get(id);
  if (!cat) return;
  const { direct } = S.categoryCounts();
  const n = direct.get(id) || 0;
  const kids = S.childrenOf(id).length;
  const kidsNote = kids ? ` Le ${kids} sottocategorie verranno spostate al livello superiore.` : '';
  if (n === 0) {
    const ok = await choiceDialog(`Eliminare la categoria "${cat.name}"?${kidsNote}`, [
      { value: null, label: 'Annulla' }, { value: 'unlink', label: 'Elimina', danger: true, primary: true }], { title: 'Elimina categoria' });
    if (!ok) return;
    await guard(async () => { await S.deleteCategory(id, 'unlink'); toast('Categoria eliminata.', { type: 'success' }); });
    return;
  }
  const sel = html(`<label class="field"><span>Categoria di destinazione (per "Sposta")</span>
     <select>${categoryOptions({ rootLabel: '— Seleziona —', excludeSubtreeOf: null })}</select></label>`);
  sel.querySelector(`option[value="${CSS.escape(id)}"]`)?.setAttribute('disabled', '');
  const choice = await choiceDialog(
    `La categoria "${cat.name}" contiene ${n} tablatur${n === 1 ? 'a' : 'e'}. Le tablature NON verranno eliminate. Cosa vuoi fare?${kidsNote}`,
    [{ value: null, label: 'Annulla eliminazione' }, { value: 'unlink', label: 'Rimuovi solo l\'associazione', danger: true }, { value: 'move', label: 'Sposta le tablature', primary: true }],
    { title: 'Elimina categoria', bodyEl: sel });
  if (!choice) return;
  const targetId = sel.querySelector('select').value || null;
  if (choice === 'move' && !targetId) { toast('Seleziona la categoria di destinazione.', { type: 'warn' }); return deleteCategoryFlow(id); }
  await guard(async () => {
    await S.deleteCategory(id, choice, targetId);
    toast(choice === 'move' ? `Categoria eliminata, tablature spostate in "${S.state.categories.get(targetId).name}".` : 'Categoria eliminata, associazioni rimosse.', { type: 'success' });
  });
}

/* --------------------------------------------------------------- unione */

export function mergeCategoriesFlow(preselectSource = '') {
  if (S.state.categories.size < 2) { toast('Servono almeno due categorie per eseguire un\'unione.', { type: 'warn' }); return; }
  const body = html(`<form class="form">
    <p class="muted small">Le tablature e le sottocategorie della categoria di origine passano nella destinazione; la categoria di origine viene eliminata.</p>
    <label class="field"><span>Unisci (origine)</span><select name="src">${categoryOptions({ selected: preselectSource, rootLabel: '— Seleziona —' })}</select></label>
    <label class="field"><span>dentro (destinazione)</span><select name="dst">${categoryOptions({ rootLabel: '— Seleziona —' })}</select></label>
    <p class="form-error" role="alert" hidden></p></form>`);
  const footer = html(`<div class="btn-row"><button type="button" class="btn" data-a="c">Annulla</button><button type="button" class="btn primary" data-a="ok">Unisci</button></div>`);
  const m = openModal({ title: 'Unisci categorie', size: 'sm', body, footer });
  footer.querySelector('[data-a=c]').onclick = () => m.close();
  footer.querySelector('[data-a=ok]').onclick = async () => {
    const src = body.src.value; const dst = body.dst.value;
    const err = body.querySelector('.form-error');
    if (!src || !dst) { err.textContent = 'Seleziona entrambe le categorie.'; err.hidden = false; return; }
    try {
      const names = [S.state.categories.get(src).name, S.state.categories.get(dst).name];
      await S.mergeCategories(src, dst);
      toast(`"${names[0]}" unita in "${names[1]}".`, { type: 'success' });
      m.close();
    } catch (e) { err.textContent = e.userMessage || e.message; err.hidden = false; }
  };
}

/* ======================================================= ALBERO (render) */

/**
 * Disegna l'albero delle categorie.
 * mode: 'nav' (barra laterale: clic = apri) | 'manage' (pagina Categorie: pulsanti di gestione)
 * handlers: { onOpen(id), activeId }
 */
export function renderTree(container, mode, handlers = {}) {
  const { direct, total } = S.categoryCounts();
  const activeId = handlers.activeId || null;
  container.innerHTML = '';
  const ul = document.createElement('ul');
  ul.className = `tree tree-${mode}`;
  ul.setAttribute('role', 'tree');
  const build = (parentId, parentUl) => {
    for (const c of S.childrenOf(parentId)) {
      const kids = S.childrenOf(c.id);
      const isCollapsed = collapsed.has(c.id);
      const li = document.createElement('li');
      li.setAttribute('role', 'treeitem');
      li.setAttribute('aria-expanded', kids.length ? String(!isCollapsed) : 'false');
      li.dataset.id = c.id;
      const d = direct.get(c.id) || 0; const t = total.get(c.id) || 0;
      const dot = c.icon ? `<span class="cat-icon">${esc(c.icon)}</span>` : `<span class="cat-dot" style="${c.color ? `background:${esc(c.color)}` : ''}"></span>`;
      const toggle = kids.length
        ? `<button type="button" class="tree-toggle" aria-label="${isCollapsed ? 'Espandi' : 'Comprimi'} ${esc(c.name)}">${isCollapsed ? '▸' : '▾'}</button>`
        : '<span class="tree-toggle-spacer"></span>';
      if (mode === 'nav') {
        li.innerHTML = `<div class="tree-row ${activeId === c.id ? 'active' : ''}">${toggle}
          <button type="button" class="tree-name" data-open="${esc(c.id)}">${dot}<span class="tree-label">${esc(c.name)}</span><span class="count" title="Totale incluse le sottocategorie">${t}</span></button></div>`;
      } else {
        li.innerHTML = `<div class="tree-row" draggable="true" data-level="${c.level}">${toggle}
          <span class="drag-handle" aria-hidden="true" title="Trascina per riordinare">⋮⋮</span>
          <button type="button" class="tree-name" data-open="${esc(c.id)}" title="${esc(c.description || 'Apri categoria')}">${dot}<span class="tree-label">${esc(c.name)}</span></button>
          <span class="tree-counts" title="Tablature dirette / totali incluse le sottocategorie">${d} / ${t}</span>
          <span class="tree-actions">
            <button type="button" class="icon-btn" data-act="sub" title="Aggiungi sottocategoria" aria-label="Aggiungi sottocategoria a ${esc(c.name)}" ${c.level >= MAX_CATEGORY_LEVEL ? 'disabled' : ''}>＋</button>
            <button type="button" class="icon-btn" data-act="up" title="Sposta su" aria-label="Sposta su">↑</button>
            <button type="button" class="icon-btn" data-act="down" title="Sposta giù" aria-label="Sposta giù">↓</button>
            <button type="button" class="icon-btn" data-act="edit" title="Modifica / sposta" aria-label="Modifica ${esc(c.name)}">✎</button>
            <button type="button" class="icon-btn" data-act="merge" title="Unisci in un'altra categoria" aria-label="Unisci">⇉</button>
            <button type="button" class="icon-btn danger" data-act="del" title="Elimina" aria-label="Elimina ${esc(c.name)}">🗑</button>
          </span></div>`;
      }
      parentUl.appendChild(li);
      if (kids.length && !isCollapsed) {
        const sub = document.createElement('ul'); sub.setAttribute('role', 'group');
        li.appendChild(sub); build(c.id, sub);
      }
    }
  };
  build(null, ul);
  if (!S.state.categories.size) {
    container.innerHTML = `<p class="muted small empty-tree">${mode === 'nav' ? 'Nessuna categoria.' : 'Nessuna categoria. Crea la prima con “Nuova categoria”.'}</p>`;
    return;
  }
  container.appendChild(ul);

  // Eventi
  ul.addEventListener('click', (e) => {
    const li = e.target.closest('li[data-id]'); if (!li) return;
    const id = li.dataset.id;
    if (e.target.closest('.tree-toggle')) {
      if (collapsed.has(id)) collapsed.delete(id); else collapsed.add(id);
      renderTree(container, mode, handlers); return;
    }
    const open = e.target.closest('[data-open]');
    if (open && handlers.onOpen) { handlers.onOpen(open.dataset.open); return; }
    const act = e.target.closest('[data-act]'); if (!act) return;
    const a = act.dataset.act;
    if (a === 'sub') openCategoryForm({ parentId: id });
    else if (a === 'edit') openCategoryForm({ id });
    else if (a === 'del') deleteCategoryFlow(id);
    else if (a === 'merge') mergeCategoriesFlow(id);
    else if (a === 'up') guard(() => S.moveCategoryStep(id, -1));
    else if (a === 'down') guard(() => S.moveCategoryStep(id, 1));
  });
  if (mode === 'manage') bindDragAndDrop(ul);
}

/** Drag & drop (desktop): rilasciando su una riga, la categoria viene posta PRIMA di essa
 *  allo stesso livello (cambiando padre se necessario e consentito). */
function bindDragAndDrop(ul) {
  let dragId = null;
  ul.addEventListener('dragstart', (e) => {
    const li = e.target.closest('li[data-id]'); if (!li) return;
    dragId = li.dataset.id;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', dragId);
    li.classList.add('dragging');
  });
  ul.addEventListener('dragend', () => { dragId = null; ul.querySelectorAll('.dragging,.drop-target').forEach((x) => x.classList.remove('dragging', 'drop-target')); });
  ul.addEventListener('dragover', (e) => {
    const row = e.target.closest('.tree-row'); if (!row || !dragId) return;
    e.preventDefault();
    ul.querySelectorAll('.drop-target').forEach((x) => x.classList.remove('drop-target'));
    row.classList.add('drop-target');
  });
  ul.addEventListener('drop', async (e) => {
    const li = e.target.closest('li[data-id]'); if (!li || !dragId) return;
    e.preventDefault();
    const targetId = li.dataset.id;
    if (targetId === dragId) return;
    const target = S.state.categories.get(targetId);
    const moving = S.state.categories.get(dragId);
    await guard(async () => {
      if ((target.parentId || null) !== (moving.parentId || null)) {
        const chk = S.canMoveCategory(dragId, target.parentId || null);
        if (!chk.ok) { toast(chk.reason, { type: 'warn' }); return; }
        await S.updateCategory(dragId, { parentId: target.parentId || null });
      }
      await S.reorderCategory(dragId, targetId);
    });
  });
}

export function expandAll() { collapsed.clear(); }
export function collapseAll() { for (const c of S.state.categories.values()) if (S.childrenOf(c.id).length) collapsed.add(c.id); }

/* ================================================== SELETTORE MULTIPLO */

/**
 * Selettore di categorie con caselle di controllo e creazione rapida.
 * Restituisce { el, getSelected(), setSelected(ids) }.
 */
export function categoryPicker(initial = []) {
  const selected = new Set(initial.filter((id) => S.state.categories.has(id)));
  const el = html(`<div class="cat-picker">
      <div class="cat-picker-head">
        <input type="search" class="cat-filter" placeholder="Filtra categorie…" aria-label="Filtra categorie">
        <button type="button" class="btn sm" data-a="new">＋ Nuova categoria</button>
      </div>
      <div class="cat-quick" hidden>
        <input class="q-name" placeholder="Nome nuova categoria" maxlength="80" aria-label="Nome nuova categoria">
        <select class="q-parent" aria-label="Categoria padre"></select>
        <button type="button" class="btn sm primary" data-a="create">Crea</button>
        <button type="button" class="btn sm" data-a="cancel">✕</button>
      </div>
      <div class="cat-picker-list" role="group" aria-label="Categorie"></div>
      <div class="cat-picker-sel small muted"></div>
    </div>`);
  const list = el.querySelector('.cat-picker-list');
  const filter = el.querySelector('.cat-filter');
  const quick = el.querySelector('.cat-quick');
  const draw = () => {
    const q = filter.value.trim().toLowerCase();
    const rows = S.flatTree().filter((c) => !q || S.categoryPath(c.id).toLowerCase().includes(q));
    list.innerHTML = rows.length ? rows.map((c) => `<label class="cat-opt" style="--lvl:${c.level}">
        <input type="checkbox" value="${esc(c.id)}" ${selected.has(c.id) ? 'checked' : ''}>
        ${c.icon ? `<span>${esc(c.icon)}</span>` : `<span class="cat-dot" style="${c.color ? `background:${esc(c.color)}` : ''}"></span>`}
        <span>${esc(c.name)}</span></label>`).join('')
      : `<p class="muted small">${S.state.categories.size ? 'Nessuna categoria corrisponde al filtro.' : 'Nessuna categoria: creane una o salva in “Senza categoria”.'}</p>`;
    const names = [...selected].map((id) => S.categoryPath(id)).filter(Boolean);
    el.querySelector('.cat-picker-sel').textContent = names.length ? `Selezionate: ${names.join(' · ')}` : 'Nessuna categoria selezionata → “Senza categoria”.';
  };
  list.addEventListener('change', (e) => {
    if (e.target.type !== 'checkbox') return;
    if (e.target.checked) selected.add(e.target.value); else selected.delete(e.target.value);
    draw();
  });
  filter.addEventListener('input', draw);
  el.querySelector('[data-a=new]').onclick = () => {
    quick.hidden = false;
    quick.querySelector('.q-parent').innerHTML = categoryOptions({ rootLabel: '— Primo livello —', onlyParents: true });
    quick.querySelector('.q-name').value = filter.value.trim();
    quick.querySelector('.q-name').focus();
  };
  el.querySelector('[data-a=cancel]').onclick = () => { quick.hidden = true; };
  const create = async () => {
    const name = quick.querySelector('.q-name').value.trim();
    const parentId = quick.querySelector('.q-parent').value || null;
    await guard(async () => {
      const c = await S.createCategory({ name, parentId });
      selected.add(c.id); quick.hidden = true; filter.value = '';
      toast(`Categoria "${c.name}" creata e selezionata.`, { type: 'success' });
      draw();
    });
  };
  el.querySelector('[data-a=create]').onclick = create;
  quick.querySelector('.q-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); create(); } });
  draw();
  return {
    el,
    getSelected: () => [...selected].filter((id) => S.state.categories.has(id)),
    setSelected: (ids) => { selected.clear(); ids.forEach((i) => selected.add(i)); draw(); },
  };
}
