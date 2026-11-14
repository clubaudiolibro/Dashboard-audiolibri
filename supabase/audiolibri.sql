-- =====================================================================
-- Toolbox — tabella `audiolibri` (copia notturna del database Notion)
--
-- Come si usa: Supabase → SQL Editor → New query → incolla TUTTO questo
-- file → Run. Si può rilanciare quante volte si vuole: non cancella dati.
--
-- Chi scrive: SOLO l'automazione notturna (repo dashboard-audiolibri-automation),
--             con la chiave segreta, chiamando audiolibri_replace().
-- Chi legge:  SOLO utenti con login (ruolo "authenticated"). Nessun accesso per "anon".
-- Nota: la lettura è consentita a qualunque utente con login. Va bene perché sei
--       l'unico utente: tieni DISATTIVATE le nuove registrazioni
--       (Authentication → Sign In / Providers → "Allow new users to sign up" = off).
-- =====================================================================

create table if not exists public.audiolibri (
  pos            integer primary key,          -- ordine delle righe nel CSV (1, 2, 3, ...)
  titolo         text not null default '',
  anno_ascolto   text not null default '',
  autore         text not null default '',
  consigliato_da text not null default '',
  durata         text not null default '',
  fine_ascolto   text not null default '',
  fisico         text not null default '',
  genere         text not null default '',
  hype           text not null default '',
  inizio_ascolto text not null default '',
  narratore      text not null default '',
  numero         text not null default '',     -- colonna "N°" del CSV
  onedrive       text not null default '',
  serie          text not null default '',
  stato          text not null default '',
  volume         text not null default '',
  voto           text not null default '',
  epub           text not null default '',
  synced_at      timestamptz not null default now()
);

alter table public.audiolibri enable row level security;

revoke all on table public.audiolibri from anon, authenticated;
grant select on table public.audiolibri to authenticated;
grant select, insert, delete on table public.audiolibri to service_role;

drop policy if exists "audiolibri_read" on public.audiolibri;
create policy "audiolibri_read" on public.audiolibri
  for select to authenticated
  using (true);

-- Sostituisce TUTTO il contenuto in una sola transazione: o si aggiornano
-- tutte le righe o non cambia nulla. Rifiuta un elenco vuoto (protezione
-- contro un export andato male).
create or replace function public.audiolibri_replace(p_rows jsonb)
returns integer
language plpgsql security invoker
set search_path = ''
as $$
declare
  n integer;
begin
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'Nessuna riga ricevuta: sostituzione annullata';
  end if;

  delete from public.audiolibri where true;

  insert into public.audiolibri (
    pos, titolo, anno_ascolto, autore, consigliato_da, durata, fine_ascolto, fisico, genere,
    hype, inizio_ascolto, narratore, numero, onedrive, serie, stato, volume, voto, epub
  )
  select
    t.ord::integer,
    coalesce(t.r ->> 'titolo', ''),         coalesce(t.r ->> 'anno_ascolto', ''),
    coalesce(t.r ->> 'autore', ''),         coalesce(t.r ->> 'consigliato_da', ''),
    coalesce(t.r ->> 'durata', ''),         coalesce(t.r ->> 'fine_ascolto', ''),
    coalesce(t.r ->> 'fisico', ''),         coalesce(t.r ->> 'genere', ''),
    coalesce(t.r ->> 'hype', ''),           coalesce(t.r ->> 'inizio_ascolto', ''),
    coalesce(t.r ->> 'narratore', ''),      coalesce(t.r ->> 'numero', ''),
    coalesce(t.r ->> 'onedrive', ''),       coalesce(t.r ->> 'serie', ''),
    coalesce(t.r ->> 'stato', ''),          coalesce(t.r ->> 'volume', ''),
    coalesce(t.r ->> 'voto', ''),           coalesce(t.r ->> 'epub', '')
  from jsonb_array_elements(p_rows) with ordinality as t(r, ord);

  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function public.audiolibri_replace(jsonb) from public, anon, authenticated;
grant execute on function public.audiolibri_replace(jsonb) to service_role;

-- Controllo finale: deve restituire una riga con rowsecurity = true
select tablename, rowsecurity from pg_tables
where schemaname = 'public' and tablename = 'audiolibri';
