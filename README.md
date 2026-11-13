# Dashboard Audiolibri

Web app statica (PWA installabile) che raccoglie:

- **Diario degli Audiolibri** — `apps/audiolibri/`
- **Citazioni in Immagine** — `apps/citazioni/` (accetta CSV e Excel .xlsx; template in `apps/citazioni/template-citazioni.xlsx`)
- **Postcard audiolibri** — `apps/postcard-audiolibri/`
- **TabShelf** — `apps/tabshelf/` (in costruzione: libreria di tablature con tag e filtri, dati su Supabase; guida più sotto)
- **Guitar Tab Library** — `apps/tablature/` (archivio di tablature per chitarra, offline: i dati restano nel browser in IndexedDB; backup/ripristino in .zip e raccolte PDF. Usa jszip, pdf-lib e PDF.js da jsDelivr con versioni bloccate, salvate in cache dal service worker; dopo la modifica di un file dell'app incrementare `CACHE_VERSION` in `apps/tablature/service-worker.js`)

Nessun build step, nessun backend: i file vengono elaborati nel browser.

## Pubblicazione su GitHub Pages
1. Carica il contenuto di questa cartella nella root del repository (es. `dashboard-audiolibri`).
2. Settings → Pages → Source: *Deploy from a branch* → branch `main`, cartella `/ (root)`.
3. Apri `https://<utente>.github.io/dashboard-audiolibri/`.

Tutti i percorsi sono relativi: il sito funziona sia nella root del dominio sia in una sottocartella.

## Memoria dei dati
- Diario: l'ultimo CSV caricato viene ricordato in questo browser (opzione «Memorizza il CSV in questo browser», attiva di default, disattivabile dalle Impostazioni del Diario). Un nuovo CSV sostituisce il precedente.
- Citazioni: ricorda impostazioni, template e copertine; le citazioni si caricano a ogni sessione.

## Aggiungere un nuovo strumento
1. Crea `apps/<id>/index.html`.
2. Aggiungi una voce in `assets/js/apps.js` (id, title, description, url, icon, tags).
3. (Consigliato) nell'`<head>` del nuovo strumento includi manifest, icone e `assets/css/app-nav.css` con percorsi `../../`, e nell'header il link `.home-link` verso `../../index.html`.

## TabShelf (in costruzione)

Libreria di tablature (JPG, PNG, PDF) con tag organizzati in categorie: si carica dal PC, si studia dal tablet.
Dati e file stanno in un progetto **Supabase** (piano gratuito) dell'utente.

**Sicurezza:** questo repository è pubblico, quindi non contiene alcun URL, chiave o password di Supabase.
Il Project URL e la chiave **pubblica** (publishable / anon) si incollano nell'app al primo avvio e restano
salvati solo nel browser. La chiave segreta (secret / service_role) non va mai usata: l'app la rifiuta.

Preparazione del database: Supabase → SQL Editor → incollare ed eseguire `apps/tabshelf/supabase/setup.sql`
(rilanciabile senza errori).
