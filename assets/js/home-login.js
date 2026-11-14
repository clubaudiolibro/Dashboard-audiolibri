/* TOOLBOX — schermata di accesso della home.
   Una volta entrati, tutte le app si aprono senza altre richieste. */
"use strict";
(function () {
  const $ = id => document.getElementById(id);
  const body = document.body;
  const T = window.Toolbox;

  /* Dopo il login si torna all'app che aveva chiesto l'accesso (solo percorsi interni apps/<id>/) */
  function nextTarget() {
    const n = new URLSearchParams(location.search).get("next") || "";
    return /^apps\/[a-z0-9-]+\/$/.test(n) ? n : null;
  }
  function goNext() { const n = nextTarget(); if (n) location.replace(n); }

  function unlock() {
    body.classList.remove("locked");
    $("login-main").hidden = true;
    $("btn-logout").hidden = false;
  }
  function lock(message) {
    body.classList.add("locked");
    $("login-main").hidden = false;
    $("btn-logout").hidden = true;
    $("login-config").hidden = !!T.loadConfig();
    showError(message || "");
    ($("login-config").hidden ? $("login-email") : $("login-url")).focus();
  }
  function showError(msg) {
    const e = $("login-error");
    e.textContent = msg; e.hidden = !msg;
  }

  async function onSubmit(ev) {
    ev.preventDefault();
    const btn = $("login-submit");
    showError("");
    btn.disabled = true; btn.textContent = "Accesso in corso…";
    try {
      if (!T.loadConfig()) T.saveConfig(T.validateConfig($("login-url").value, $("login-key").value));
      const email = $("login-email").value, pw = $("login-password").value;
      if (!email.trim() || !pw) throw new Error("Inserisci email e password.");
      await T.signIn(email, pw);
      $("login-password").value = "";
      unlock();
      goNext();
    } catch (e) {
      showError(e && e.message ? e.message : "Accesso non riuscito.");
    } finally {
      btn.disabled = false; btn.textContent = "Accedi";
    }
  }

  async function init() {
    if (!T) return;
    $("login-form").addEventListener("submit", onSubmit);
    $("btn-logout").addEventListener("click", async () => { await T.signOut(); lock("Sei uscito."); });

    if (location.protocol === "file:") { unlock(); return; }   // uso locale da file
    if (T.hasLocalSession() && T.loadConfig()) {
      unlock();
      goNext();
      // verifica in background; senza rete non si blocca nulla
      try {
        const user = await T.getUser();
        if (!user && navigator.onLine) lock("Sessione scaduta: accedi di nuovo.");
      } catch (e) {}
      return;
    }
    lock();
  }
  document.addEventListener("DOMContentLoaded", init);
})();
