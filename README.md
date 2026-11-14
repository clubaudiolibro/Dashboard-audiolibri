# Toolbox Alessandro

Web app statica (PWA installabile) che raccoglie:

- **Diario degli Audiolibri** — `apps/audiolibri/`
- **Citazioni in Immagine** — `apps/citazioni/` (accetta CSV e Excel .xlsx; template in `apps/citazioni/template-citazioni.xlsx`)
- **Postcard audiolibri** — `apps/postcard-audiolibri/`
- **TabShelf** — `apps/tabshelf/` (libreria di tablature con tag e filtri: si carica dal PC, si studia dal tablet; dati e file su Supabase. Guida completa più sotto)
- `apps/tablature/` — contiene solo il reindirizzamento a TabShelf della vecchia *Guitar Tab Library* (vedi «Vecchia Guitar Tab Library»)

Nessun build step e nessun framework: HTML, CSS e JavaScript (moduli ES) con percorsi relativi.
Gli strumenti elaborano i file nel browser. I dati online (TabShelf e archivio audiolibri sincronizzato da Notion) stanno nel progetto Supabase personale e si vedono solo dopo il login.

## Accesso (login unico)
- Il login con email e password si fa **una sola volta nella home**; poi tutte le app si aprono senza altre richieste. Se si apre un'app direttamente senza sessione, si viene rimandati alla home e poi riportati all'app.
- Gli utenti sono quelli del progetto Supabase (gli stessi di TabShelf): non si creano account in più. Le nuove registrazioni vanno tenute disattivate.
- `assets/js/toolbox-auth.js` gestisce client e sessione (stessi nomi di memoria di TabShelf, `tabshelf.config` e `tabshelf.auth`); `assets/js/toolbox-guard.js` è il controllo d'ingresso delle singole app.
- URL del progetto e chiave **pubblica** (mai la secret/service_role) si possono scrivere in `assets/js/toolbox-config.js`; se restano vuoti li chiede la schermata di accesso, una volta per dispositivo.
- Il login protegge la navigazione; la protezione vera dei dati è RLS su Supabase (nessun dato sta in questa repo pubblica).

## Archivio audiolibri nel cloud
Ogni notte alle 03:00 la repo privata `dashboard-audiolibri-automation` copia il database Notion nella tabella Supabase `audiolibri`. Il Diario degli Audiolibri la legge all'apertura (`apps/audiolibri/cloud.js`) e usa la stessa importazione del CSV. Se il cloud non risponde restano i dati ricordati nel browser, e il caricamento manuale del CSV funziona sempre.
Preparazione del database: `supabase/audiolibri.sql` (una volta sola, nel SQL Editor di Supabase).

## Pubblicazione su GitHub Pages
1. Carica il contenuto di questa cartella nella root del repository (es. `dashboard-audiolibri`).
2. Settings → Pages → Source: *Deploy from a branch* → branch `main`, cartella `/ (root)`.
3. Apri `https://<utente>.github.io/dashboard-audiolibri/`.

Tutti i percorsi sono relativi: il sito funziona sia nella root del dominio sia in una sottocartella.

## Memoria dei dati
- Diario: l'ultimo CSV caricato viene ricordato in questo browser (opzione «Memorizza il CSV in questo browser», attiva di default, disattivabile dalle Impostazioni del Diario). Un nuovo CSV sostituisce il precedente.
- Citazioni: ricorda impostazioni, template e copertine; le citazioni si caricano a ogni sessione.

## Versioni e registro delle versioni
- Ogni strumento ha una versione (campo `version` in `assets/js/apps.js`), mostrata sulla sua card nella homepage.
- **Regola: ogni aggiornamento di uno strumento deve incrementare la sua versione** (`1.0` → `1.1` per
  modifiche piccole, → `2.0` per cambiamenti grandi) **e aggiungere una riga in cima a `CHANGELOG`**, sempre in
  `assets/js/apps.js` (data, id dello strumento, versione, descrizione brevissima). Le modifiche alla homepage
  stessa usano l'id `toolbox`.
- In fondo alla homepage, «Registro delle versioni» mostra questo storico.
- TabShelf ha la sua versione anche in `apps/tabshelf/js/config.js` (`APP_VERSION`, visibile nelle Impostazioni
  e nei backup): va tenuta uguale a quella di `apps.js`.

## Aggiungere un nuovo strumento
1. Crea `apps/<id>/index.html`.
2. Aggiungi una voce in `assets/js/apps.js` (id, title, description, url, icon, tags, version `"1.0"`) e una riga in `CHANGELOG`.
3. Per richiedere l'accesso dalla home, nell'`<head>` aggiungi `<script src="../../assets/js/toolbox-guard.js"></script>`. Se lo strumento ha dati online: crea la tabella in `supabase/<nome>.sql` con RLS attiva, nessun permesso ad `anon` e una policy per `authenticated`; nel frontend usa `await Toolbox.getClient()` (`assets/js/toolbox-auth.js`).
4. (Consigliato) nell'`<head>` del nuovo strumento includi manifest, icone e `assets/css/app-nav.css` con percorsi `../../`, e nell'header il link `.home-link` verso `../../index.html`.

## TabShelf

Libreria di tablature (JPG, PNG, PDF) con tag organizzati in categorie.

- **Gestione** (pensata per il PC): caricamento multiplo con trascinamento, anteprima, rotazione e ritaglio,
  compressione delle immagini nel browser (lato lungo max 2200 px, WebP qualità ~0,85; se il risultato è più
  grande dell'originale resta l'originale), miniature WebP da 400 px (anche per i PDF, prima pagina),
  coda con avanzamento e «Riprova»; «Da classificare»; libreria con ricerca, filtri e azioni in blocco;
  scheda documento; categorie e tag (ordine manuale, colori, unione); cestino.
- **Visualizzazione** (pensata per il tablet): filtri a chip (1 tocco includi, 2 escludi, 3 neutro;
  OR nella stessa categoria, AND tra categorie), stato, voto minimo, ricerca, ordinamenti (anche casuale
  con «Mischia»), raccolte preferite, schermo intero con swipe, zoom, PDF a pagine verticali e schermo
  sempre acceso.

### Sicurezza

- Il repository è **pubblico**: non contiene e non deve contenere URL, chiavi, password o email di Supabase
  (negli esempi si usano solo segnaposto come `https://<id-progetto>.supabase.co`).
- L'app usa solo la chiave **pubblica** (publishable `sb_publishable_…` o, nei progetti vecchi, `anon`).
  La chiave segreta (`sb_secret_…` o `service_role`) non va **mai** usata: l'app la rifiuta.
- I dati sono protetti dalle regole RLS del database (ognuno vede solo le proprie righe) e dalle regole
  del bucket privato `tabshelf` (ognuno accede solo alla cartella `<user_id>/`). Il ruolo `anon`
  (chi non ha fatto login) non ha accesso a nessuna tabella; può solo chiamare `tabshelf_ping()`,
  che non legge né scrive dati (serve al workflow keepalive).
- Login con email e password (Supabase Auth); un solo utente, registrazione disattivata.
- I file si leggono solo tramite URL firmati temporanei (1 ora, rinnovati automaticamente).
- La pagina ha `noindex, nofollow` e non invia il referrer ad altri siti.

### Preparazione di Supabase (una volta sola)

1. Su [supabase.com](https://supabase.com) creare un account gratuito e un nuovo progetto (regione UE).
   Annotare la password del database. Nella sezione *Security*: lasciare attivo *Enable Data API*;
   *Automatically expose new tables* può restare disattivato (i permessi li dà `setup.sql`).
2. **Authentication → Sign In / Providers**: disattivare *Allow new users to sign up* e salvare.
   **Authentication → Users → Add user → Create new user**: email e password, con *Auto Confirm User* attivo.
3. **SQL Editor**: incollare tutto `apps/tabshelf/supabase/setup.sql` ed eseguirlo (*Run*). È rilanciabile
   senza errori e senza perdere dati. Alla fine deve comparire la riga `tabshelf | false | 52428800`
   (bucket privato).
4. Copiare il **Project URL** (Project Settings → Data API; se mostra `…/rest/v1/` l'app lo toglie da sola)
   e la **chiave pubblica** (Project Settings → API Keys → *Publishable key*). I nomi nel pannello di
   Supabase possono cambiare nel tempo.

**Aggiornamenti dello schema:** quando `setup.sql` cambia (la versione è in `tabshelf_schema_version()` e in
`SCHEMA_VERSION` di `apps/tabshelf/js/config.js`), l'app mostra «Database da preparare»: basta rieseguire
il file nel SQL Editor.

### Collegare un dispositivo

- **Primo dispositivo:** aprire `apps/tabshelf/index.html`; nella schermata «Collega TabShelf» incollare
  Project URL e chiave pubblica, poi accedere con email e password. I dati di collegamento restano solo
  in quel browser (localStorage).
- **Altri dispositivi:** in TabShelf → Impostazioni → «Collega un altro dispositivo» c'è un link (con
  pulsante Copia) e un QR code. Il link ha la forma
  `…/apps/tabshelf/index.html#cfg=<base64url di {"url": "...", "key": "..."}>`: la parte dopo `#` non viene
  mai inviata al server; l'app la legge, la salva e la cancella subito dall'indirizzo. Contiene i dati di
  connessione ma **non la password**: condividerlo solo con i propri dispositivi.
- Impostazioni → «Scollega questo dispositivo» cancella dal browser collegamento, sessione e miniature salvate.

### File e cache

- `apps/tabshelf/js/config.js`: tutte le impostazioni (soglie di spazio, dimensioni delle immagini,
  versioni delle librerie). Le librerie arrivano da jsDelivr con versione bloccata: supabase-js 2.119.0,
  PDF.js 6.5.438, jszip 3.10.2, qrcode-generator 2.0.4 (supabase-js anche in `index.html`).
- `apps/tabshelf/js/storage.js`: unico punto di accesso ai file (URL firmati, cache delle miniature).
- **Service worker** (`apps/tabshelf/service-worker.js`): gestisce solo i file dell'app e le librerie
  jsDelivr, mai i dati o i file di Supabase. I file dell'app vengono presi prima dalla rete (gli
  aggiornamenti si vedono subito), la cache serve solo senza connessione. Le cache hanno prefisso
  `tabshelf-app-`. **`CACHE_VERSION`**: incrementarla (es. `tabshelf-app-v5` → `tabshelf-app-v6`) quando si
  aggiungono, rinominano o tolgono file dell'app, aggiornando anche l'elenco `CORE`; all'attivazione le
  vecchie cache `tabshelf-app-*` vengono cancellate.
- Le miniature sono salvate nel browser (Cache API, cache `tabshelf-thumbs-v1`, chiave = percorso del file).

### Spazio e avvisi

Lo spazio occupato (somma di `file_size` e `thumb_size`) è sempre visibile nel Cestino e nelle Impostazioni.
Un banner avvisa quando i documenti nel cestino superano **100 MB** o il totale supera l'**80% di 1 GB**
(soglie in `SPACE` di `js/config.js`). Il cestino non si svuota mai da solo.

### Formato del backup

Impostazioni → «Crea backup» (consigliato dal PC) crea `tabshelf-backup-AAAA-MM-GG.zip`, escluso il cestino:

```
documenti/<titolo, o nome originale senza estensione> - <primi 8 caratteri dell'id>.<estensione>
tabshelf-dati.json
documenti.csv
FILE-MANCANTI.txt     (solo se qualche file non è stato scaricato)
```

`tabshelf-dati.json`:

```json
{
  "app": "TabShelf",
  "app_version": "1.0",
  "schema_version": 2,
  "exported_at": "2026-01-31T10:00:00.000Z",
  "categories":    [{ "id": "…", "name": "Genere", "sort_order": 10, "created_at": "…" }],
  "tags":          [{ "id": "…", "category_id": "…", "name": "Blues", "color": "#2c7fb8", "sort_order": 10, "created_at": "…" }],
  "documents":     [{ "id": "…", "title": "…", "artist": "…", "notes": "…", "original_name": "foto.jpg",
                      "file_type": "image", "file_size": 123456, "status": "da_fare", "mastery": 4,
                      "created_at": "…", "file": "documenti/… - 1a2b3c4d.webp" }],
  "document_tags": [{ "document_id": "…", "tag_id": "…" }],
  "collections":   [{ "id": "…", "name": "…", "created_at": "…",
                      "filter": { "include": ["<tag_id>"], "exclude": [], "status": ["in_corso"], "minMastery": 0, "sort": "title" } }]
}
```

- `status`: `da_fare` | `in_corso` | `completo`; `mastery`: 1–5 oppure `null`; `file_type`: `image` | `pdf`.
- `file` è il percorso del documento dentro lo zip; gli id sono quelli del database.
- `sort` delle raccolte: `title` | `newest` | `oldest` | `random`.
- `documenti.csv`: separatore `;`, UTF-8 con BOM (si apre direttamente in Excel in italiano); colonne
  Titolo, Artista, Tag (`Categoria: tag` separati da ` | `), Stato, Voto, Note, Nome file originale, Tipo,
  Dimensione (KB), Data di caricamento, File nel backup, ID.

Il **ripristino da backup non è ancora disponibile**: il formato qui sopra è pensato per permetterlo in futuro.

### Limiti del piano gratuito di Supabase

- 500 MB di database, **1 GB di file**, 5 GB di traffico al mese, file singolo max 50 MB.
- Il progetto va **in pausa dopo 7 giorni senza attività** (si riattiva dal pannello di Supabase).
  Per evitarlo c'è il workflow `.github/workflows/supabase-keepalive.yml`: ogni 3 giorni (e a mano dalla
  scheda *Actions*) chiama `tabshelf_ping`. Richiede i secrets del repository `SUPABASE_URL` e
  `SUPABASE_ANON_KEY` (chiave **pubblica**); se mancano termina senza errore.
- **Attenzione:** GitHub disattiva i workflow programmati dopo **60 giorni senza attività** nel repository
  (nessun commit): in quel caso riattivarlo dalla scheda *Actions*.

### Vecchia Guitar Tab Library

`apps/tablature/` contiene solo `index.html`, che reindirizza a `../tabshelf/index.html` (vecchi segnalibri),
e un `service-worker.js` che sostituisce il vecchio service worker cache-first: si attiva subito, cancella
le cache con prefisso `gtl-`, si deregistra e ricarica le schede aperte. I vecchi dati rimasti in IndexedDB
non vengono toccati né importati.
