/**
 * ui.js — Notifiche, finestre di dialogo e conferme.
 */
import { esc, h, errorMessage } from './util.js';

/* ------------------------------------------------------------------ notifiche */

/** Mostra una notifica breve. type: 'info' | 'ok' | 'warn' | 'error'. */
export function toast(message, { type = 'info', duration, action } = {}) {
  const host = document.getElementById('toast-host');
  const el = h(`<div class="toast toast-${type}" role="${type === 'error' ? 'alert' : 'status'}">
    <span class="toast-msg">${esc(message)}</span>
    ${action ? `<button type="button" class="toast-action">${esc(action.label)}</button>` : ''}
    <button type="button" class="toast-close" aria-label="Chiudi">×</button>
  </div>`);
  const close = () => { el.classList.add('leaving'); setTimeout(() => el.remove(), 200); };
  el.querySelector('.toast-close').onclick = close;
  if (action) el.querySelector('.toast-action').onclick = () => { close(); action.onClick(); };
  host.appendChild(el);
  const ms = duration ?? (type === 'error' ? 7000 : action ? 8000 : 3500);
  if (ms > 0) setTimeout(close, ms);
  return close;
}

/** Notifica d'errore a partire da un'eccezione. */
export function toastError(err, prefix = '') {
  console.error(err);
  toast((prefix ? `${prefix}: ` : '') + errorMessage(err), { type: 'error' });
}

/* ------------------------------------------------------------------ finestre */

/**
 * Apre una finestra di dialogo modale.
 * opts: { title, body (stringa HTML o elemento), actions: [{label, value, kind:'primary'|'danger'|'', close:true}], size:'sm'|'md'|'lg', dismissible }
 * Restituisce { el, body, close(value), result: Promise }.
 */
export function openDialog({ title = '', body = '', actions = [], size = 'md', dismissible = true } = {}) {
  const dlg = h(`<dialog class="dialog dialog-${size}">
    <form method="dialog" class="dialog-inner">
      <header class="dialog-head"><h2>${esc(title)}</h2>
        ${dismissible ? '<button type="button" class="icon-btn dialog-x" aria-label="Chiudi">✕</button>' : ''}</header>
      <div class="dialog-body"></div>
      <footer class="dialog-foot"></footer>
    </form>
  </dialog>`);
  const bodyEl = dlg.querySelector('.dialog-body');
  if (typeof body === 'string') bodyEl.innerHTML = body; else if (body) bodyEl.appendChild(body);
  const foot = dlg.querySelector('.dialog-foot');
  if (!actions.length) foot.remove();
  let resolveFn;
  const result = new Promise((r) => { resolveFn = r; });
  let done = false;
  const close = (value) => {
    if (done) return; done = true;
    dlg.close(); dlg.remove(); resolveFn(value);
  };
  actions.forEach((a) => {
    const b = h(`<button type="button" class="btn ${a.kind || ''}">${esc(a.label)}</button>`);
    b.onclick = async () => {
      if (a.onClick) {
        const r = await a.onClick();
        if (r === false) return; // l'azione chiede di restare aperti
      }
      if (a.close !== false) close(a.value);
    };
    foot.appendChild(b);
  });
  dlg.querySelector('.dialog-x')?.addEventListener('click', () => close(undefined));
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); if (dismissible) close(undefined); });
  dlg.querySelector('form').addEventListener('submit', (e) => {
    e.preventDefault();
    const primary = actions.find((a) => a.kind === 'primary' || a.kind === 'danger');
    if (primary) foot.querySelectorAll('button')[actions.indexOf(primary)].click();
  });
  document.body.appendChild(dlg);
  dlg.showModal();
  return { el: dlg, body: bodyEl, close, result };
}

/** Conferma sì/no. Restituisce true se confermato. */
export async function confirmDialog(message, { title = 'Conferma', ok = 'Conferma', cancel = 'Annulla', danger = false } = {}) {
  const d = openDialog({
    title, size: 'sm',
    body: `<p>${message}</p>`,
    actions: [
      { label: cancel, value: false },
      { label: ok, value: true, kind: danger ? 'danger' : 'primary' },
    ],
  });
  return (await d.result) === true;
}

/** Richiede un testo. Restituisce la stringa (anche vuota) o null se annullato. */
export async function promptDialog(label, { title = '', value = '', ok = 'Salva', placeholder = '' } = {}) {
  const body = h(`<label class="field"><span>${esc(label)}</span>
    <input type="text" value="${esc(value)}" placeholder="${esc(placeholder)}" autocomplete="off"></label>`);
  const input = body.querySelector('input');
  const d = openDialog({
    title: title || label, size: 'sm', body,
    actions: [
      { label: 'Annulla', value: null },
      { label: ok, kind: 'primary', onClick: () => { d.value = input.value.trim(); } },
    ],
  });
  setTimeout(() => { input.focus(); input.select(); }, 30);
  const r = await d.result;
  return r === null || r === undefined ? (d.value ?? null) : null;
}

/* ------------------------------------------------------------------ banner */

/** Mostra o aggiorna un banner fisso sotto l'intestazione (id univoco). */
export function setBanner(id, message, type = 'warn') {
  const host = document.getElementById('banners');
  let el = host.querySelector(`[data-banner="${id}"]`);
  if (!message) { el?.remove(); return; }
  if (!el) {
    el = h(`<div class="banner banner-${type}" data-banner="${esc(id)}" role="status"></div>`);
    host.appendChild(el);
  }
  el.innerHTML = message;
}
