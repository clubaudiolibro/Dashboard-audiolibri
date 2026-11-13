/** Pagina provvisoria per le sezioni non ancora pronte. */
import { esc } from '../util.js';

export function renderPlaceholder(el, title, text) {
  el.innerHTML = `<section class="page">
    <h1>${esc(title)}</h1>
    <div class="panel empty"><p>${esc(text)}</p></div>
  </section>`;
}
