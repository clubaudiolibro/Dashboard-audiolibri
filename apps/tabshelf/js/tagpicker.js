/**
 * tagpicker.js — Campo per scegliere i tag con autocompletamento e creazione al volo.
 * Scorciatoia: scrivendo "Categoria: nome" il tag viene creato direttamente in quella categoria.
 */
import { state, activeCategories, activeTags, compareTags } from './store.js';
import { createTag, createCategory, findTag } from './actions.js';
import { esc, h, norm } from './util.js';
import { openDialog, toastError } from './ui.js';

export const DEFAULT_TAG_COLOR = '#7a7f88';

/** Mappa id categoria -> categoria (anche eliminate). */
export function categoryById(id) { return state.categories.find((c) => c.id === id); }
export function tagById(id) { return state.tags.find((t) => t.id === id); }

/** HTML di un "chip" di tag. */
export function tagChipHtml(tag, { removable = false, withCategory = false, extraClass = '' } = {}) {
  const cat = categoryById(tag.category_id);
  const color = tag.color || DEFAULT_TAG_COLOR;
  return `<span class="tag-chip ${extraClass}" style="--c:${esc(color)}" data-tag="${esc(tag.id)}" title="${esc(cat ? `${cat.name} › ${tag.name}` : tag.name)}">
    ${withCategory && cat ? `<small>${esc(cat.name)} ›</small>` : ''}${esc(tag.name)}
    ${removable ? `<button type="button" class="chip-x" aria-label="Togli ${esc(tag.name)}" data-remove="${esc(tag.id)}">×</button>` : ''}
  </span>`;
}

/** Tag attivi ordinati per categoria e nome. */
export function sortedActiveTags() {
  const order = new Map(activeCategories().map((c, i) => [c.id, i]));
  return activeTags().sort((a, b) => (order.get(a.category_id) - order.get(b.category_id)) || compareTags(a, b));
}

/**
 * Crea il selettore.
 * opts: { value: [tagId], onChange(ids), placeholder }
 */
export function createTagPicker({ value = [], onChange = () => {}, placeholder = 'Aggiungi tag…' } = {}) {
  let selected = [...value];
  const el = h(`<div class="tagpicker">
    <div class="tp-box">
      <span class="tp-chips"></span>
      <input type="text" class="tp-input" placeholder="${esc(placeholder)}" autocomplete="off" spellcheck="false"
        role="combobox" aria-expanded="false" aria-autocomplete="list" aria-label="Aggiungi tag">
    </div>
    <ul class="tp-menu" role="listbox" hidden></ul>
  </div>`);
  const chips = el.querySelector('.tp-chips');
  const input = el.querySelector('.tp-input');
  const menu = el.querySelector('.tp-menu');
  let options = [];
  let active = 0;

  const renderChips = () => {
    chips.innerHTML = selected.map((id) => tagById(id)).filter(Boolean)
      .map((t) => tagChipHtml(t, { removable: true, withCategory: true })).join('');
  };
  const commit = () => { renderChips(); onChange([...selected]); };

  chips.addEventListener('click', (e) => {
    const id = e.target.closest('[data-remove]')?.dataset.remove;
    if (!id) return;
    selected = selected.filter((x) => x !== id);
    commit();
    input.focus();
  });

  const close = () => { menu.hidden = true; input.setAttribute('aria-expanded', 'false'); };
  const open = () => {
    const q = input.value.trim();
    const nq = norm(q);
    const [catPart, tagPart] = q.includes(':') ? q.split(':').map((s) => s.trim()) : [null, q];
    const list = sortedActiveTags().filter((t) => !selected.includes(t.id));
    let matches;
    if (!nq) matches = list;
    else if (catPart !== null) {
      matches = list.filter((t) => norm(categoryById(t.category_id)?.name).includes(norm(catPart)) && norm(t.name).includes(norm(tagPart)));
    } else {
      matches = list.filter((t) => norm(t.name).includes(nq) || norm(categoryById(t.category_id)?.name).includes(nq));
      matches.sort((a, b) => (norm(b.name).startsWith(nq) - norm(a.name).startsWith(nq)));
    }
    options = matches.slice(0, 60).map((t) => ({ type: 'tag', tag: t }));
    const exact = matches.some((t) => norm(t.name) === norm(tagPart || q));
    if (q && !exact && (tagPart || q)) options.push({ type: 'create', name: tagPart || q, catName: catPart });
    if (!options.length) { close(); return; }
    active = Math.min(active, options.length - 1);
    menu.innerHTML = options.map((o, i) => (o.type === 'tag'
      ? `<li role="option" data-i="${i}" class="${i === active ? 'active' : ''}"><span class="dot" style="background:${esc(o.tag.color || DEFAULT_TAG_COLOR)}"></span>${esc(o.tag.name)} <small>${esc(categoryById(o.tag.category_id)?.name || '')}</small></li>`
      : `<li role="option" data-i="${i}" class="create ${i === active ? 'active' : ''}">＋ Crea il tag «${esc(o.name)}»${o.catName ? ` in «${esc(o.catName)}»` : '…'}</li>`)).join('');
    menu.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    menu.querySelector('.active')?.scrollIntoView({ block: 'nearest' });
  };

  const choose = async (o) => {
    if (!o) return;
    if (o.type === 'tag') {
      selected.push(o.tag.id);
    } else {
      try {
        const tag = await createTagInteractive(o.name, o.catName);
        if (!tag) return;
        if (!selected.includes(tag.id)) selected.push(tag.id);
      } catch (e) { toastError(e); return; }
    }
    input.value = ''; active = 0;
    commit(); close(); input.focus();
  };

  input.addEventListener('input', () => { active = 0; open(); });
  input.addEventListener('focus', open);
  input.addEventListener('blur', () => setTimeout(close, 150));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); if (menu.hidden) open(); else { active = Math.min(options.length - 1, active + 1); open(); } }
    else if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(0, active - 1); open(); }
    else if (e.key === 'Enter') { e.preventDefault(); if (!menu.hidden) choose(options[active]); }
    else if (e.key === 'Escape') { if (!menu.hidden) { e.stopPropagation(); e.preventDefault(); close(); } }
    else if (e.key === 'Backspace' && !input.value && selected.length) { selected.pop(); commit(); }
  });
  menu.addEventListener('mousedown', (e) => e.preventDefault()); // non perdere il focus
  menu.addEventListener('click', (e) => {
    const li = e.target.closest('[data-i]');
    if (li) choose(options[+li.dataset.i]);
  });

  renderChips();
  return {
    el,
    get value() { return [...selected]; },
    set value(ids) { selected = [...ids]; renderChips(); },
    focus() { input.focus(); },
  };
}

/**
 * Crea un tag chiedendo (se serve) la categoria. catName facoltativo: se corrisponde
 * a una categoria esistente la usa, altrimenti propone di crearla.
 * Restituisce il tag (nuovo o già esistente) oppure null se annullato.
 */
export async function createTagInteractive(name, catName = null) {
  const cats = activeCategories();
  if (catName) {
    let cat = cats.find((c) => norm(c.name) === norm(catName));
    if (!cat) cat = await createCategory(catName);
    return findTag(cat.id, name) || createTag(cat.id, name);
  }
  const last = localStorage.getItem('tabshelf.lastCategory');
  const body = h(`<div class="stack">
    <p>In quale categoria va il tag <strong>«${esc(name)}»</strong>?</p>
    <label class="field"><span>Categoria</span>
      <select>
        ${cats.map((c) => `<option value="${esc(c.id)}" ${c.id === last ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
        <option value="__new" ${cats.length ? '' : 'selected'}>＋ Nuova categoria…</option>
      </select>
    </label>
    <label class="field" data-new ${cats.length ? 'hidden' : ''}><span>Nome della nuova categoria</span>
      <input type="text" placeholder="es. Genere, Tecnica, Tonalità" autocomplete="off"></label>
  </div>`);
  const select = body.querySelector('select');
  const newWrap = body.querySelector('[data-new]');
  const newInput = newWrap.querySelector('input');
  select.onchange = () => { newWrap.hidden = select.value !== '__new'; if (!newWrap.hidden) newInput.focus(); };
  let result = null;
  const d = openDialog({
    title: 'Nuovo tag', size: 'sm', body,
    actions: [
      { label: 'Annulla', value: null },
      { label: 'Crea tag', kind: 'primary', onClick: async () => {
        try {
          let catId = select.value;
          if (catId === '__new') {
            if (!newInput.value.trim()) { newInput.focus(); return false; }
            catId = (await createCategory(newInput.value)).id;
          }
          localStorage.setItem('tabshelf.lastCategory', catId);
          result = findTag(catId, name) || await createTag(catId, name);
          return true;
        } catch (e) { toastError(e); return false; }
      } },
    ],
  });
  setTimeout(() => (select.value === '__new' ? newInput : select).focus(), 30);
  await d.result;
  return result;
}
