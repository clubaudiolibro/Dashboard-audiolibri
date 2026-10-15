# Dashboard Audiolibri

Web app statica (PWA installabile) che raccoglie:

- **Diario degli Audiolibri** — `apps/audiolibri/`
- **Citazioni in Immagine** — `apps/citazioni/`

Nessun build step, nessun backend: i CSV vengono elaborati nel browser.

## Pubblicazione su GitHub Pages
1. Carica il contenuto di questa cartella nella root del repository (es. `dashboard-audiolibri`).
2. Settings → Pages → Source: *Deploy from a branch* → branch `main`, cartella `/ (root)`.
3. Apri `https://<utente>.github.io/dashboard-audiolibri/`.

Tutti i percorsi sono relativi: il sito funziona sia nella root del dominio sia in una sottocartella.

## Installazione come app
- **Chrome / Edge desktop**: icona "Installa" nella barra degli indirizzi oppure menu ⋮ → *Trasmetti, salva e condividi* / *App* → *Installa*.
- **Chrome Android**: menu ⋮ → *Aggiungi a schermata Home* / *Installa app*.

## Aggiungere un nuovo strumento
1. Crea `apps/<id>/index.html`.
2. Aggiungi una voce in `assets/js/apps.js` (id, title, description, url, icon, tags).
3. (Consigliato) nell'`<head>` del nuovo strumento includi manifest, icone e `assets/css/app-nav.css` con percorsi `../../`, e nell'header il link `.home-link` verso `../../index.html` (copialo da uno degli strumenti esistenti).
