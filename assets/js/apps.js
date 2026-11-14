/* =====================================================================
   TOOLBOX ALESSANDRO — registro di categorie e applicativi
   Per aggiungere un nuovo strumento:
     1. crea la cartella /apps/<id>/ con il suo index.html
     2. aggiungi una voce in APPS con gli stessi campi
   Campi: id, title, description, url (relativo alla root),
          category (chiave di CATEGORIES), featured (true = in evidenza),
          icon (SVG 24x24 a tratto), tags (facoltativo).
   Una categoria compare nei filtri solo se ha almeno un applicativo.
   ===================================================================== */

const CATEGORIES = {
  audiolibri: { label: "Audiolibri", color: "#2f6f62" },
  chitarra:   { label: "Chitarra",   color: "#c2632b" },
  film:       { label: "Film",       color: "#8a3fb8" },
  utility:    { label: "Utility",    color: "#3b6fd1" }
};

const APPS = [
  {
    id: "audiolibri",
    title: "Diario degli Audiolibri",
    description: "Analizza il tuo archivio di audiolibri con statistiche, grafici, filtri e indicatori.",
    url: "./apps/audiolibri/index.html",
    category: "audiolibri",
    featured: true,
    tags: ["CSV Notion", "Grafici", "Filtri"],
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="m7 15 4-4 3 3 5-6"/></svg>'
  },
  {
    id: "citazioni",
    title: "Citazioni in Immagine",
    description: "Trasforma le citazioni dei tuoi libri in immagini personalizzate pronte da condividere.",
    url: "./apps/citazioni/index.html",
    category: "audiolibri",
    featured: false,
    tags: ["CSV / Excel", "PNG / JPG", "ZIP"],
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10 11H6a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v6c0 2.5-1.5 4-4 4.5"/><path d="M19 11h-4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v6c0 2.5-1.5 4-4 4.5"/></svg>'
  },
  {
    id: "postcard-audiolibri",
    title: "Postcard audiolibri",
    description: "Crea cartoline dei tuoi ascolti con copertina, autore, narratore e durata.",
    url: "./apps/postcard-audiolibri/index.html",
    category: "audiolibri",
    featured: false,
    tags: ["CSV / Excel", "1:1 · 9:16 · 3:4", "PNG / JPG / ZIP"],
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M14 4v16M17 9h1M17 13h1"/><rect x="6" y="8" width="5" height="5" rx="1"/></svg>'
  },
  {
    id: "tabshelf",
    title: "TabShelf",
    description: "Libreria di tablature con tag e filtri: carichi dal PC, studi dal tablet.",
    url: "./apps/tabshelf/index.html",
    category: "chitarra",
    featured: false,
    tags: ["Tag", "Immagini / PDF", "PC + tablet"],
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="5" width="3" height="13" rx="1"/><rect x="8.5" y="7" width="3" height="11" rx="1"/><path d="M3 21h18"/><path d="M17 16V6l3 1"/><circle cx="15.5" cy="16" r="1.6"/></svg>'
  }
];
