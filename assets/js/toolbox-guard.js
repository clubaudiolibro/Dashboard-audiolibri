/* TOOLBOX — controllo d'ingresso per le singole app.
   Se in questo browser non c'è una sessione, rimanda alla home (dove si fa il login) e poi torna qui.
   È solo una comodità di navigazione: la protezione vera dei dati è RLS su Supabase. */
(function () {
  if (location.protocol === "file:") return;           // uso locale da file: nessun controllo
  try {
    var s = JSON.parse(localStorage.getItem("tabshelf.auth") || "null");
    if (s && (s.access_token || s.refresh_token)) return;
  } catch (e) {}
  var src = document.currentScript && document.currentScript.src;
  if (!src) return;
  var home = src.replace(/assets\/js\/toolbox-guard\.js.*$/, "index.html");
  var m = location.pathname.match(/\/(apps\/[a-z0-9-]+\/)(?:index\.html)?$/);
  location.replace(home + (m ? "?next=" + encodeURIComponent(m[1]) : ""));
})();
