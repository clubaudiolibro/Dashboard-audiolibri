/* TOOLBOX ALESSANDRO — homepage: card, filtri, in evidenza, tema, installazione */
"use strict";
(function () {
  const THEME_KEY = "toolbox.theme";
  const FILTER_KEY = "toolbox.filter";
  const ARROW = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14"/><path d="m13 6 6 6-6 6"/></svg>';
  const THEME_ICONS = {
    auto:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor"/></svg>',
    light: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
    dark:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>'
  };
  const THEME_LABELS = { auto: "Tema: automatico", light: "Tema: chiaro", dark: "Tema: scuro" };
  const NEXT_THEME = { auto: "light", light: "dark", dark: "auto" };

  const CATS = (typeof CATEGORIES !== "undefined") ? CATEGORIES : {};
  const LIST = (typeof APPS !== "undefined" && Array.isArray(APPS)) ? APPS : [];

  function store(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function read(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  /* ---------- Tema ---------- */
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  function currentTheme() { const t = read(THEME_KEY); return (t === "light" || t === "dark") ? t : "auto"; }
  function applyTheme(t) {
    const root = document.documentElement;
    if (t === "auto") delete root.dataset.theme; else root.dataset.theme = t;
    store(THEME_KEY, t);
    const b = document.getElementById("btn-theme");
    if (b) { b.innerHTML = THEME_ICONS[t]; b.title = THEME_LABELS[t]; b.setAttribute("aria-label", THEME_LABELS[t] + " (clicca per cambiare)"); }
    const isDark = t === "dark" || (t === "auto" && mq.matches);
    const meta = document.getElementById("theme-color");
    if (meta) meta.setAttribute("content", isDark ? "#121417" : "#f6f5f2");
  }

  /* ---------- Card ---------- */
  function card(app) {
    const cat = CATS[app.category] || { label: "", color: "#5d6470" };
    const a = el("a", "app-card");
    a.href = app.url;
    a.dataset.app = app.id;
    a.style.setProperty("--cat", cat.color);
    a.setAttribute("aria-label", app.title + " — " + app.description);

    const top = el("span", "app-top");
    const icon = el("span", "app-icon");
    icon.setAttribute("aria-hidden", "true");
    icon.innerHTML = app.icon || "";
    top.appendChild(icon);
    if (cat.label) top.appendChild(el("span", "app-cat", cat.label));

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

    a.append(top, body, open);
    return a;
  }

  /* ---------- In evidenza ---------- */
  function renderFeatured() {
    const feat = LIST.filter(a => a.featured);
    const sec = document.getElementById("featured-section");
    const grid = document.getElementById("featured-grid");
    grid.textContent = "";
    feat.forEach(app => grid.appendChild(card(app)));
    sec.hidden = feat.length === 0;
  }

  /* ---------- Filtri + griglia ---------- */
  function usedCategories() {
    return Object.keys(CATS).filter(k => LIST.some(a => a.category === k));
  }

  function renderGrid(filter) {
    const grid = document.getElementById("app-grid");
    const items = filter === "all" ? LIST : LIST.filter(a => a.category === filter);
    grid.textContent = "";
    items.forEach(app => grid.appendChild(card(app)));
    const c = document.getElementById("app-count");
    if (c) c.textContent = items.length === 1 ? "1 strumento" : items.length + " strumenti";
  }

  function renderFilters() {
    const box = document.getElementById("filters");
    const cats = usedCategories();
    let active = read(FILTER_KEY) || "all";
    if (active !== "all" && !cats.includes(active)) active = "all";

    box.textContent = "";
    box.hidden = cats.length < 2;            // con una sola categoria i filtri non servono

    const make = (key, label, color) => {
      const b = el("button", "pill", label);
      b.type = "button";
      b.dataset.filter = key;
      if (color) b.style.setProperty("--cat", color);
      b.setAttribute("aria-pressed", String(key === active));
      b.addEventListener("click", () => {
        box.querySelectorAll(".pill").forEach(p => p.setAttribute("aria-pressed", String(p === b)));
        store(FILTER_KEY, key);
        renderGrid(key);
      });
      return b;
    };
    box.appendChild(make("all", "Tutti"));
    cats.forEach(k => box.appendChild(make(k, CATS[k].label, CATS[k].color)));
    renderGrid(active);
  }

  /* Diario degli Audiolibri: "Memorizza il CSV in questo browser" attiva di default (prefsRev 2) */
  try {
    const KEY = "adb.prefs.v1";
    const prefs = JSON.parse(localStorage.getItem(KEY) || "{}") || {};
    if (prefs.prefsRev !== 2) { prefs.saveData = true; prefs.prefsRev = 2; localStorage.setItem(KEY, JSON.stringify(prefs)); }
  } catch (e) {}

  /* ---------- Installazione PWA ---------- */
  let deferred = null;
  window.addEventListener("beforeinstallprompt", e => {
    e.preventDefault(); deferred = e;
    const b = document.getElementById("btn-install"); if (b) b.hidden = false;
  });
  window.addEventListener("appinstalled", () => {
    deferred = null; const b = document.getElementById("btn-install"); if (b) b.hidden = true;
  });

  document.addEventListener("DOMContentLoaded", () => {
    applyTheme(currentTheme());
    document.getElementById("btn-theme").addEventListener("click", () => applyTheme(NEXT_THEME[currentTheme()]));
    mq.addEventListener("change", () => { if (currentTheme() === "auto") applyTheme("auto"); });

    renderFeatured();
    renderFilters();

    const b = document.getElementById("btn-install");
    if (b) b.addEventListener("click", async () => {
      if (!deferred) return;
      deferred.prompt();
      try { await deferred.userChoice; } catch (e) {}
      deferred = null; b.hidden = true;
    });
  });
})();
