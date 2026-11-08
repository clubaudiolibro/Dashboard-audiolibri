/**
 * pdfexport.js — Raccolta PDF delle tablature (pdf-lib): copertina, indice con
 * numeri di pagina, tablature impaginate (più per pagina oppure pagina dedicata)
 * con didascalia, numerazione. Il PDF serve per stampa/consultazione e NON è un backup.
 */
import * as S from './store.js';
import { esc, html, tabTitle, isoDay, formatDate, downloadBlob, errorMessage, UserError, nextFrame } from './utils.js';
import { openModal, toast, progress } from './ui.js';
import { blobToJpeg } from './images.js';

let resultsProvider = () => [];
/** app.js fornisce le tablature dell'archivio correntemente filtrate. */
export function setResultsProvider(fn) { resultsProvider = fn; }

const PAGES = { a4: [595.28, 841.89], letter: [612, 792] };
const MARGIN = 36;
const GAP = 14;
const ROW_H = 17;      // altezza riga dell'indice
const MAX_UPSCALE = 1.5;

function needPdfLib() {
  if (!globalThis.PDFLib) {
    throw new UserError(navigator.onLine
      ? 'La libreria PDF non è stata caricata. Ricarica la pagina e riprova.'
      : 'La libreria PDF non è ancora disponibile offline: apri l\'app almeno una volta con la connessione attiva.');
  }
  return globalThis.PDFLib;
}

/* ================================================================== DIALOGO */

export function openPdfExport() {
  if (!S.state.tabs.size) { toast('L\'archivio è vuoto: nessuna tablatura da esportare.', { type: 'warn' }); return null; }
  const results = resultsProvider();
  const hasResults = results.length > 0 && results.length < S.state.tabs.size;
  const favCount = [...S.state.tabs.values()].filter((t) => t.favorite).length;

  const body = html(`<form class="form pdf-form" novalidate>
    <fieldset class="field"><legend>Quali tablature</legend>
      <label class="check"><input type="radio" name="src" value="results" ${hasResults ? 'checked' : ''} ${results.length ? '' : 'disabled'}> Risultati correnti dell'archivio (${results.length})</label>
      <label class="check"><input type="radio" name="src" value="all" ${hasResults ? '' : 'checked'}> Tutte (${S.state.tabs.size})</label>
      <label class="check"><input type="radio" name="src" value="fav" ${favCount ? '' : 'disabled'}> Solo preferiti (${favCount})</label>
      <label class="check"><input type="radio" name="src" value="cat" ${S.state.categories.size ? '' : 'disabled'}> Categorie scelte</label>
      <div class="pdf-cat-list" hidden>${S.flatTree().map((c) => `<label class="cat-opt" style="--lvl:${c.level}"><input type="checkbox" name="cat" value="${esc(c.id)}"> <span>${esc(c.icon ? c.icon + ' ' : '')}${esc(c.name)}</span></label>`).join('')}</div>
      <label class="check small" data-sub hidden><input type="checkbox" name="sub" checked> Includi le sottocategorie</label>
    </fieldset>
    <label class="field"><span>Titolo della raccolta</span><input name="title" maxlength="80" value="Raccolta tablature"></label>
    <div class="field-row">
      <label class="field"><span>Formato pagina</span><select name="size"><option value="a4">A4</option><option value="letter">Letter</option></select></label>
      <label class="field"><span>Ordine</span><select name="group"><option value="1">Raggruppate per categoria</option><option value="0">Come nell'archivio</option></select></label>
    </div>
    <label class="check"><input type="checkbox" name="cover" checked> Copertina</label>
    <label class="check"><input type="checkbox" name="index" checked> Indice con numeri di pagina</label>
    <label class="check"><input type="checkbox" name="caption" checked> Didascalia sopra ogni tablatura (titolo, categoria, CAGED, tonalità)</label>
    <p class="info-box small pdf-count" role="status"></p>
  </form>`);
  const footer = html(`<div class="btn-row"><button type="button" class="btn" data-a="c">Annulla</button><button type="button" class="btn primary" data-a="ok">Crea PDF</button></div>`);
  const m = openModal({ title: 'Crea raccolta PDF', size: 'md', body, footer });
  const catList = body.querySelector('.pdf-cat-list');
  const subBox = body.querySelector('[data-sub]');
  const okBtn = footer.querySelector('[data-a=ok]');

  /** Tablature scelte (con esclusioni rispettate). */
  const pick = () => {
    const src = body.querySelector('input[name=src]:checked')?.value || 'all';
    const all = [...S.state.tabs.values()].sort((a, b) => a.order - b.order);
    let list;
    if (src === 'results') list = resultsProvider();
    else if (src === 'fav') list = all.filter((t) => t.favorite);
    else if (src === 'cat') {
      const set = new Set();
      body.querySelectorAll('input[name=cat]:checked').forEach((c) => { set.add(c.value); if (body.elements.sub.checked) S.descendantIds(c.value).forEach((d) => set.add(d)); });
      list = all.filter((t) => t.categoryIds.some((c) => set.has(c)));
    } else list = all;
    const included = list.filter((t) => !t.pdf.exclude);
    return { included, excluded: list.length - included.length };
  };
  const refresh = () => {
    const src = body.querySelector('input[name=src]:checked')?.value;
    catList.hidden = src !== 'cat'; subBox.hidden = src !== 'cat';
    const { included, excluded } = pick();
    body.querySelector('.pdf-count').textContent = `${included.length} tablatur${included.length === 1 ? 'a' : 'e'} nel PDF${excluded ? ` (${excluded} escluse dalle opzioni avanzate)` : ''}.`;
    okBtn.disabled = !included.length;
  };
  body.addEventListener('change', refresh);
  refresh();

  footer.querySelector('[data-a=c]').onclick = () => m.close();
  okBtn.onclick = async () => {
    const { included } = pick();
    if (!included.length) return;
    const opts = {
      title: body.elements.title.value.trim() || 'Raccolta tablature',
      size: body.elements.size.value, group: body.elements.group.value === '1',
      cover: body.elements.cover.checked, index: body.elements.index.checked, caption: body.elements.caption.checked,
    };
    m.close();
    await createPdf(included, opts);
  };
  return m;
}

/* ================================================================== IMPAGINAZIONE */

/** Testo adatto al font standard (WinAnsi): scarta i caratteri non codificabili. */
function makeSafe(font) {
  const ok = new Map();
  const repl = { '’': "'", '‘': "'", '“': '"', '”': '"', '–': '-', '—': '-', '→': '->', '←': '<-', ' ': ' ', '\t': ' ' };
  return (text) => {
    let out = '';
    for (const ch of String(text ?? '').replace(/[\r\n]+/g, ' ')) {
      const c = repl[ch] ?? ch;
      for (const x of c) {
        if (!ok.has(x)) { try { font.widthOfTextAtSize(x, 10); ok.set(x, true); } catch { ok.set(x, false); } }
        if (ok.get(x)) out += x;
      }
    }
    return out;
  };
}

/** Tronca il testo con "..." perché stia in maxW. */
function fit(text, font, size, maxW) {
  if (font.widthOfTextAtSize(text, size) <= maxW) return text;
  let t = text;
  while (t.length > 1 && font.widthOfTextAtSize(t + '...', size) > maxW) t = t.slice(0, -1);
  return t.trimEnd() + '...';
}

/** Ordina e raggruppa le tablature; restituisce voci { type:'heading'|'tab' }. */
function buildItems(tabs, opts) {
  if (!opts.group) return tabs.map((tab) => ({ type: 'tab', tab }));
  const order = new Map(S.flatTree().map((c, i) => [c.id, i]));
  const keyOf = (t) => {
    const ids = t.categoryIds.filter((c) => order.has(c)).sort((a, b) => order.get(a) - order.get(b));
    return ids[0] || null;
  };
  const groups = new Map();
  for (const t of tabs) { const k = keyOf(t); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(t); }
  const keys = [...groups.keys()].sort((a, b) => (a === null) - (b === null) || (order.get(a) ?? 0) - (order.get(b) ?? 0));
  const items = [];
  for (const k of keys) {
    items.push({ type: 'heading', text: k ? S.categoryPath(k) : 'Senza categoria' });
    groups.get(k).forEach((tab) => items.push({ type: 'tab', tab }));
  }
  return items;
}

/**
 * Calcola le pagine: ogni pagina ha orientamento e un elenco di blocchi con
 * posizione verticale (dall'alto) e dimensioni dell'immagine.
 */
function layout(items, opts) {
  const [W, H] = PAGES[opts.size] || PAGES.a4;
  const capH = opts.caption ? 30 : 0;
  const headH = 28;
  const pages = [];
  let cur = null;
  const dims = (o) => (o === 'landscape' ? { pw: H, ph: W } : { pw: W, ph: H });
  const newPage = (orient, dedicated = false) => {
    const d = dims(orient);
    cur = { orient, pw: d.pw, ph: d.ph, cw: d.pw - 2 * MARGIN, ch: d.ph - 2 * MARGIN - 8, used: 0, dedicated, blocks: [] };
    pages.push(cur);
    return cur;
  };
  items.forEach((it, i) => {
    if (it.type === 'heading') {
      // Un titolo di gruppo non deve restare isolato in fondo alla pagina.
      if (!cur || cur.dedicated || cur.ch - cur.used < headH + capH + 90) newPage('portrait');
      it.page = pages.length - 1;
      cur.blocks.push({ kind: 'heading', text: it.text, top: cur.used, h: headH });
      cur.used += headH;
      return;
    }
    const t = it.tab;
    const w = Math.max(1, t.imgWidth || 1000); const h = Math.max(1, t.imgHeight || 400);
    const own = t.pdf.ownPage || t.orientation !== 'auto';
    const orient = t.orientation === 'landscape' ? 'landscape' : t.orientation === 'portrait' ? 'portrait' : (own && w > h * 1.15 ? 'landscape' : 'portrait');
    const d = dims(orient);
    const cw = d.pw - 2 * MARGIN; const ch = d.ph - 2 * MARGIN - 8;
    const s = Math.min(MAX_UPSCALE, cw / w, (ch - capH) / h);
    const bw = w * s; const bh = h * s;
    const need = capH + bh + GAP;
    if (own) newPage(orient, true);
    else if (!cur || cur.dedicated || cur.ch - cur.used < need - GAP) newPage('portrait');
    it.page = pages.length - 1;
    cur.blocks.push({ kind: 'tab', tab: t, top: cur.used, capH, bw, bh });
    cur.used += need;
    void i;
  });
  return pages;
}

/* ================================================================== GENERAZIONE */

async function createPdf(tabs, opts) {
  const prog = progress('Creazione del PDF…');
  try {
    const { PDFDocument, StandardFonts, rgb } = needPdfLib();
    const pdf = await PDFDocument.create();
    pdf.setTitle(opts.title); pdf.setProducer('Guitar Tab Library'); pdf.setCreator('Guitar Tab Library'); pdf.setCreationDate(new Date());
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
    const safe = makeSafe(font);
    const [W, H] = PAGES[opts.size] || PAGES.a4;
    const gray = rgb(0.4, 0.42, 0.47); const dark = rgb(0.1, 0.11, 0.15); const accent = rgb(0.18, 0.36, 0.85);

    const items = buildItems(tabs, opts);
    const plan = layout(items, opts);

    // Numerazione: copertina (1) + pagine d'indice + contenuto
    const entries = items.length;
    const rowsPerPage = Math.max(1, Math.floor((H - 2 * MARGIN - 50) / ROW_H));
    const indexPages = opts.index && entries ? Math.ceil(entries / rowsPerPage) : 0;
    const firstContent = (opts.cover ? 1 : 0) + indexPages + 1;

    /* ---- copertina ---- */
    if (opts.cover) {
      const p = pdf.addPage([W, H]);
      const title = safe(opts.title);
      const lines = []; let line = '';
      for (const word of title.split(' ')) {
        const tryLine = line ? `${line} ${word}` : word;
        if (bold.widthOfTextAtSize(tryLine, 34) > W - 2 * MARGIN - 20 && line) { lines.push(line); line = word; } else line = tryLine;
      }
      if (line) lines.push(line);
      let y = H * 0.62;
      for (const l of lines) { p.drawText(l, { x: (W - bold.widthOfTextAtSize(l, 34)) / 2, y, size: 34, font: bold, color: dark }); y -= 42; }
      p.drawRectangle({ x: W / 2 - 40, y: y - 6, width: 80, height: 3, color: accent });
      const sub = `${tabs.length} tablatur${tabs.length === 1 ? 'a' : 'e'}  -  ${safe(formatDate(new Date()))}`;
      p.drawText(sub, { x: (W - font.widthOfTextAtSize(sub, 13)) / 2, y: y - 36, size: 13, font, color: gray });
      const brand = 'Guitar Tab Library';
      p.drawText(brand, { x: (W - font.widthOfTextAtSize(brand, 10)) / 2, y: MARGIN, size: 10, font, color: gray });
    }

    /* ---- indice ---- */
    if (indexPages) {
      let n = 0;
      for (let ip = 0; ip < indexPages; ip++) {
        const p = pdf.addPage([W, H]);
        p.drawText(ip === 0 ? 'Indice' : 'Indice (continua)', { x: MARGIN, y: H - MARGIN - 18, size: 20, font: bold, color: dark });
        let y = H - MARGIN - 50;
        for (let r = 0; r < rowsPerPage && n < entries; r++, n++) {
          const it = items[n];
          const pageNo = String(firstContent + it.page);
          const nw = font.widthOfTextAtSize(pageNo, 10);
          if (it.type === 'heading') {
            p.drawText(fit(safe(it.text), bold, 11, W - 2 * MARGIN - nw - 12), { x: MARGIN, y, size: 11, font: bold, color: accent });
          } else {
            const label = fit(safe(tabTitle(it.tab)), font, 10, W - 2 * MARGIN - nw - 40);
            const lw = font.widthOfTextAtSize(label, 10);
            p.drawText(label, { x: MARGIN + 12, y, size: 10, font, color: dark });
            p.drawLine({ start: { x: MARGIN + 12 + lw + 4, y: y + 2 }, end: { x: W - MARGIN - nw - 6, y: y + 2 }, thickness: 0.5, color: rgb(0.75, 0.77, 0.82), dashArray: [1, 2] });
          }
          p.drawText(pageNo, { x: W - MARGIN - nw, y, size: 10, font, color: gray });
          y -= ROW_H;
        }
      }
    }

    /* ---- contenuto ---- */
    for (let pi = 0; pi < plan.length; pi++) {
      const pg = plan[pi];
      const p = pdf.addPage([pg.pw, pg.ph]);
      for (const b of pg.blocks) {
        const yTop = pg.ph - MARGIN - b.top;
        if (b.kind === 'heading') {
          p.drawText(fit(safe(b.text), bold, 14, pg.cw), { x: MARGIN, y: yTop - 18, size: 14, font: bold, color: accent });
          p.drawLine({ start: { x: MARGIN, y: yTop - 23 }, end: { x: pg.pw - MARGIN, y: yTop - 23 }, thickness: 0.7, color: accent });
          continue;
        }
        const t = b.tab;
        prog.update(`${tabs.indexOf(t) + 1} di ${tabs.length}: ${tabTitle(t)}`, tabs.indexOf(t) / tabs.length);
        if (opts.caption) {
          p.drawText(fit(safe(tabTitle(t)), bold, 11, pg.cw), { x: MARGIN, y: yTop - 11, size: 11, font: bold, color: dark });
          const cat = t.categoryIds.find((c) => S.state.categories.has(c));
          const meta = [cat ? S.categoryPath(cat) : '', t.caged.join(t.cagedOrdered ? ' -> ' : ', '), [...t.keys, t.customKey].filter(Boolean).join(', '), t.description].filter(Boolean).join('  |  ');
          if (meta) p.drawText(fit(safe(meta), font, 8.5, pg.cw), { x: MARGIN, y: yTop - 23, size: 8.5, font, color: gray });
        }
        const img = await embedTabImage(pdf, t);
        p.drawImage(img, { x: MARGIN, y: yTop - b.capH - b.bh, width: b.bw, height: b.bh });
        await nextFrame();
      }
      const num = String(firstContent + pi);
      p.drawText(num, { x: (pg.pw - font.widthOfTextAtSize(num, 9)) / 2, y: MARGIN / 2 - 2, size: 9, font, color: gray });
    }

    prog.update('Salvataggio…', 1);
    const bytes = await pdf.save();
    const blob = new Blob([bytes], { type: 'application/pdf' });
    const name = safe(opts.title).replace(/[\\/:*?"<>|]+/g, ' ').trim().replace(/\s+/g, '-').toLowerCase() || 'raccolta-tablature';
    downloadBlob(blob, `${name}-${isoDay()}.pdf`);
    prog.close();
    toast(`PDF creato: ${tabs.length} tablature, ${plan.length + (opts.cover ? 1 : 0) + indexPages} pagine.`, { type: 'success', duration: 5000 });
  } catch (e) {
    console.error(e);
    prog.close();
    toast('Creazione del PDF non riuscita: ' + errorMessage(e), { type: 'error', duration: 8000 });
  }
}

/** Incorpora l'immagine di una tablatura (PNG/JPEG diretti, altri formati via JPEG). */
async function embedTabImage(pdf, tab) {
  const rec = await S.getImageBlob(tab.imageId);
  const mime = rec.mime || rec.blob.type;
  if (mime === 'image/png') return pdf.embedPng(await rec.blob.arrayBuffer());
  if (mime === 'image/jpeg') return pdf.embedJpg(await rec.blob.arrayBuffer());
  return pdf.embedJpg(await (await blobToJpeg(rec.blob, 0.92)).arrayBuffer());
}
