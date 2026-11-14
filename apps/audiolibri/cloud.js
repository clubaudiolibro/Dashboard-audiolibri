/* Diario degli Audiolibri — caricamento automatico dei dati dal cloud.
   Dopo il login della home, legge la tabella `audiolibri` (aggiornata ogni notte da Notion),
   ricostruisce il CSV e lo passa alla STESSA funzione di importazione usata per il file manuale.
   Se il cloud non è raggiungibile restano i dati ricordati nel browser e il caricamento manuale del CSV. */
"use strict";
(function () {
  const HEADERS = ["Titolo", "Anno Ascolto", "Autore", "Consigliato da", "Durata", "Fine Ascolto", "Fisico", "Genere",
    "Hype", "Inizio Ascolto", "Narratore", "N°", "OneDrive", "Serie", "Stato", "Volume", "Voto", "epub"];
  const FIELDS = ["titolo", "anno_ascolto", "autore", "consigliato_da", "durata", "fine_ascolto", "fisico", "genere",
    "hype", "inizio_ascolto", "narratore", "numero", "onedrive", "serie", "stato", "volume", "voto", "epub"];

  const cell = v => { v = v == null ? "" : String(v); return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };

  async function fetchAll(client) {
    const out = [], size = 1000;
    for (let from = 0; ; from += size) {
      const { data, error } = await client.from("audiolibri").select("*").order("pos", { ascending: true }).range(from, from + size - 1);
      if (error) throw error;
      out.push(...data);
      if (data.length < size) break;
    }
    return out;
  }

  async function load() {
    if (!window.Toolbox || location.protocol === "file:") return;
    try {
      if (!(await Toolbox.getUser())) return;
      const rows = await fetchAll(await Toolbox.getClient());
      if (!rows.length) { toast("Nessun dato nel cloud: usa il CSV"); return; }
      const csv = [HEADERS.map(cell).join(",")]
        .concat(rows.map(r => FIELDS.map(f => cell(r[f])).join(","))).join("\n");
      const when = new Date(rows.reduce((m, r) => (r.synced_at > m ? r.synced_at : m), ""));
      importText(csv, "Notion · sincronizzazione automatica", isNaN(when) ? new Date() : when,
        [{ level: "info", msg: "Dati caricati dal cloud (aggiornati ogni notte alle 03:00)." }]);
    } catch (e) {
      console.warn("Dati cloud non disponibili", e);
      toast("Dati cloud non disponibili: uso quelli del browser o il CSV");
    }
  }
  document.addEventListener("DOMContentLoaded", load);
})();
