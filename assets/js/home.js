/* DASHBOARD AUDIOLIBRI — homepage: genera le card dal registro APPS (assets/js/apps.js) */
"use strict";
(function () {
  const ARROW = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14"/><path d="m13 6 6 6-6 6"/></svg>';

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function card(app) {
    const a = el("a", "app-card");
    a.href = app.url;                       // percorso relativo: funziona anche in sottocartella (GitHub Pages)
    a.dataset.app = app.id;
    a.setAttribute("aria-label", app.title + " — " + app.description);

    const icon = el("span", "app-icon");
    icon.setAttribute("aria-hidden", "true");
    icon.innerHTML = app.icon || "";        // markup SVG definito nel registro (contenuto fidato)

    const body = el("span", "app-body");
    body.appendChild(el("span", "app-title", app.title));
    body.appendChild(el("span", "app-desc", app.description));
    if (Array.isArray(app.tags) && app.tags.length) {
      const tags = el("span", "app-tags");
      app.tags.forEach(t => tags.appendChild(el("span", "app-tag", t)));
      body.appendChild(tags);
    }

    const open = el("span", "app-open");
    open.setAttribute("aria-hidden", "true");
    open.appendChild(el("span", null, "Apri"));
    open.insertAdjacentHTML("beforeend", ARROW);

    a.append(icon, body, open);
    return a;
  }

  function render() {
    const grid = document.getElementById("app-grid");
    const list = (typeof APPS !== "undefined" && Array.isArray(APPS)) ? APPS : [];
    grid.textContent = "";
    list.forEach(app => grid.appendChild(card(app)));
    const c = document.getElementById("app-count");
    if (c) c.textContent = list.length === 1 ? "1 strumento" : list.length + " strumenti";
  }

  /* Pulsante "Installa" facoltativo: compare solo se il browser emette beforeinstallprompt.
     In ogni caso l'app resta installabile dal menu del browser / icona nella barra degli indirizzi. */
  let deferred = null;
  window.addEventListener("beforeinstallprompt", e => {
    e.preventDefault(); deferred = e;
    const b = document.getElementById("btn-install"); if (b) b.hidden = false;
  });
  window.addEventListener("appinstalled", () => {
    deferred = null; const b = document.getElementById("btn-install"); if (b) b.hidden = true;
  });

  document.addEventListener("DOMContentLoaded", () => {
    render();
    const b = document.getElementById("btn-install");
    if (b) b.addEventListener("click", async () => {
      if (!deferred) return;
      deferred.prompt();
      try { await deferred.userChoice; } catch (e) {}
      deferred = null; b.hidden = true;
    });
  });
})();
