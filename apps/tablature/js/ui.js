/**
 * ui.js — Componenti di interfaccia riutilizzabili: notifiche, finestre modali,
 * dialoghi di conferma/scelta, indicatore di avanzamento.
 */
import { esc, html, errorMessage } from './utils.js';

/* ------------------------------------------------------------------ toast */
/**
 * Mostra una notifica. options: { type: 'info'|'success'|'error'|'warn', action: {label, onClick}, duration }
 */
export function toast(message, options = {}) {
  const { type = 'info', action = null, duration = action ? 7000 : 3500 } = options;
  const host = document.getElementById('toast-host');
  const el = html(`<div class="toast toast-${type}" role="${type === 'error' ? 'alert' : 'status'}">
      <span class="toast-msg">${esc(message)}</span>
      ${action ? `<button type="button" class="toast-action">${esc(action.label)}</button>` : ''}
      <button type="button" class="toast-close" aria-label="Chiudi notifica">×</button>
    </div>`);
  const close = () => { el.classList.add('leaving'); setTimeout(() => el.remove(), 250); };
  el.querySelector('.toast-close').onclick = close;
  if (action) {
    el.querySelector('.toast-action').onclick = async () => { close(); try { await action.onClick(); } catch (e) { toast(e.message, { type: 'error' }); } };
  }
  host.appendChild(el);
  if (duration > 0) setTimeout(close, type === 'error' ? Math.max(duration, 6000) : duration);
  return close;
}

/* ------------------------------------------------------------------ modali */
const modalStack = [];

/**
 * Apre una finestra modale.
 * opts: { title, body (HTMLElement|string), footer (HTMLElement|string), size: 'sm'|'md'|'lg'|'full', onClose, closable }
 * Restituisce { el, body, footer, close }.
 */
export function openModal(opts) {
  const { title = '', size = 'md', onClose = null, closable = true } = opts;
  const root = html(`<div class="modal-backdrop" role="presentation">
      <div class="modal modal-${size}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
        <header class="modal-header">
          <h2 class="modal-title">${esc(title)}</h2>
          ${closable ? '<button type="button" class="icon-btn modal-x" aria-label="Chiudi">✕</button>' : ''}
        </header>
        <div class="modal-body"></div>
        <footer class="modal-footer"></footer>
      </div>
    </div>`);
  const body = root.querySelector('.modal-body');
  const footer = root.querySelector('.modal-footer');
  if (typeof opts.body === 'string') body.innerHTML = opts.body; else if (opts.body) body.appendChild(opts.body);
  if (typeof opts.footer === 'string') footer.innerHTML = opts.footer; else if (opts.footer) footer.appendChild(opts.footer);
  if (!opts.footer) footer.remove();
  const prevFocus = document.activeElement;
  let closed = false;
  const api = {
    el: root, body, footer,
    close(result) {
      if (closed) return; closed = true;
      const i = modalStack.indexOf(api); if (i >= 0) modalStack.splice(i, 1);
      root.remove();
      if (!modalStack.length) document.body.classList.remove('modal-open');
      if (prevFocus && prevFocus.focus) try { prevFocus.focus(); } catch { /* ignorato */ }
      if (onClose) onClose(result);
    },
    closable,
  };
  if (closable) {
    root.querySelector('.modal-x').onclick = () => api.close();
    root.addEventListener('mousedown', (e) => { if (e.target === root) api.close(); });
  }
  document.getElementById('modal-host').appendChild(root);
  document.body.classList.add('modal-open');
  modalStack.push(api);
  // Focus sul primo campo utile
  setTimeout(() => {
    const f = root.querySelector('[autofocus], input:not([type=hidden]):not([type=checkbox]):not([type=radio]), select, textarea, .modal-footer button.primary');
    (f || root.querySelector('.modal')).focus?.();
  }, 30);
  return api;
}

/** Chiude la modale in primo piano (usato dal tasto Esc). */
export function closeTopModal() {
  const top = modalStack[modalStack.length - 1];
  if (top && top.closable) { top.close(); return true; }
  return false;
}
export const hasOpenModal = () => modalStack.length > 0;

/** Dialogo di conferma. Restituisce Promise<boolean>. */
export function confirmDialog(message, { title = 'Conferma', okLabel = 'Conferma', cancelLabel = 'Annulla', danger = false } = {}) {
  return new Promise((resolve) => {
    const footer = html(`<div class="btn-row">
        <button type="button" class="btn" data-r="0">${esc(cancelLabel)}</button>
        <button type="button" class="btn primary ${danger ? 'danger' : ''}" data-r="1">${esc(okLabel)}</button></div>`);
    const m = openModal({ title, size: 'sm', body: `<p class="dialog-text">${esc(message)}</p>`, footer, onClose: (r) => resolve(r === true) });
    footer.querySelectorAll('button').forEach((b) => { b.onclick = () => m.close(b.dataset.r === '1'); });
  });
}

/**
 * Dialogo a scelta multipla. choices: [{ value, label, primary?, danger? }]
 * Restituisce Promise<value|null>.
 */
export function choiceDialog(message, choices, { title = 'Scegli', bodyEl = null } = {}) {
  return new Promise((resolve) => {
    const body = document.createElement('div');
    body.innerHTML = `<p class="dialog-text">${esc(message)}</p>`;
    if (bodyEl) body.appendChild(bodyEl);
    const footer = html(`<div class="btn-row wrap">${choices.map((c, i) =>
      `<button type="button" class="btn ${c.primary ? 'primary' : ''} ${c.danger ? 'danger' : ''}" data-i="${i}">${esc(c.label)}</button>`).join('')}</div>`);
    const m = openModal({ title, size: 'sm', body, footer, onClose: (r) => resolve(r === undefined ? null : r) });
    footer.querySelectorAll('button').forEach((b) => { b.onclick = () => m.close(choices[+b.dataset.i].value); });
  });
}

/** Overlay di avanzamento per operazioni lunghe. */
export function progress(title) {
  const el = html(`<div class="progress-overlay" role="alertdialog" aria-live="polite">
      <div class="progress-box"><div class="spinner" aria-hidden="true"></div>
      <p class="progress-title">${esc(title)}</p><p class="progress-detail"></p>
      <div class="progress-bar"><div class="progress-fill"></div></div></div></div>`);
  document.body.appendChild(el);
  return {
    update(detail, ratio = null) {
      el.querySelector('.progress-detail').textContent = detail || '';
      if (ratio !== null) el.querySelector('.progress-fill').style.width = `${Math.round(Math.max(0, Math.min(1, ratio)) * 100)}%`;
    },
    close() { el.remove(); },
  };
}

/** Esegue una funzione asincrona mostrando eventuali errori come toast. */
export async function guard(fn, errorPrefix = '') {
  try { return await fn(); } catch (e) {
    console.error(e);
    toast((errorPrefix ? errorPrefix + ' ' : '') + errorMessage(e), { type: 'error' });
    return undefined;
  }
}
