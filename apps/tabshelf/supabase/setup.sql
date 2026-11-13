-- =====================================================================
-- TabShelf — preparazione del database Supabase
--
-- Come si usa: Supabase → SQL Editor → New query → incolla TUTTO questo
-- file → Run. Si può rilanciare quante volte si vuole: non cancella dati.
--
-- Contiene:
--   * tabelle categories, tags, documents, document_tags, collections
--   * sicurezza a livello di riga (RLS): ognuno vede solo le proprie righe
--   * nessun accesso al ruolo "anon" (chi non ha fatto login)
--   * funzioni: unione di tag, pulizia delle raccolte, versione dello schema
--   * bucket privato "tabshelf" con regole sui percorsi <user_id>/...
--
-- Versione dello schema: 1 (vedi tabshelf_schema_version e js/config.js)
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. TABELLE
-- ---------------------------------------------------------------------

create table if not exists public.categories (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name        text not null,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

create table if not exists public.tags (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  category_id uuid not null references public.categories (id) on delete cascade,
  name        text not null,
  color       text,
  created_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

create table if not exists public.documents (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title         text,
  artist        text,
  notes         text,
  original_name text,
  file_path     text,
  thumb_path    text,
  file_type     text,
  file_size     bigint,
  thumb_size    bigint,
  status        text not null default 'da_fare',
  mastery       smallint,
  created_at    timestamptz not null default now(),   -- data di caricamento
  deleted_at    timestamptz
);

create table if not exists public.document_tags (
  document_id uuid not null references public.documents (id) on delete cascade,
  tag_id      uuid not null references public.tags (id) on delete cascade,
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (document_id, tag_id)
);

create table if not exists public.collections (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name        text not null,
  filter      jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

-- Vincoli (aggiunti solo se mancano, così il file resta rilanciabile)
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'documents_file_type_check') then
    alter table public.documents add constraint documents_file_type_check
      check (file_type is null or file_type in ('image', 'pdf'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'documents_status_check') then
    alter table public.documents add constraint documents_status_check
      check (status in ('da_fare', 'in_corso', 'completo'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'documents_mastery_check') then
    alter table public.documents add constraint documents_mastery_check
      check (mastery is null or mastery between 1 and 5);
  end if;
end $$;

-- Nome del tag unico (senza distinguere maiuscole) dentro la categoria, tra quelli non eliminati
create unique index if not exists tags_unique_name_per_category
  on public.tags (category_id, lower(name)) where deleted_at is null;

-- Nome della categoria unico tra quelle non eliminate
create unique index if not exists categories_unique_name
  on public.categories (user_id, lower(name)) where deleted_at is null;

-- Indici per le ricerche più frequenti
create index if not exists categories_user_idx     on public.categories (user_id);
create index if not exists tags_user_idx           on public.tags (user_id);
create index if not exists tags_category_idx       on public.tags (category_id);
create index if not exists documents_user_idx      on public.documents (user_id);
create index if not exists document_tags_user_idx  on public.document_tags (user_id);
create index if not exists document_tags_tag_idx   on public.document_tags (tag_id);
create index if not exists collections_user_idx    on public.collections (user_id);


-- ---------------------------------------------------------------------
-- 2. PERMESSI: niente per "anon", tutto (filtrato da RLS) per "authenticated"
-- ---------------------------------------------------------------------

revoke all on table public.categories, public.tags, public.documents,
                    public.document_tags, public.collections from anon;
grant select, insert, update, delete on table public.categories, public.tags, public.documents,
                    public.document_tags, public.collections to authenticated;


-- ---------------------------------------------------------------------
-- 3. SICUREZZA A LIVELLO DI RIGA (RLS)
-- ---------------------------------------------------------------------

alter table public.categories    enable row level security;
alter table public.tags          enable row level security;
alter table public.documents     enable row level security;
alter table public.document_tags enable row level security;
alter table public.collections   enable row level security;

drop policy if exists "tabshelf_categories_own" on public.categories;
create policy "tabshelf_categories_own" on public.categories
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "tabshelf_tags_own" on public.tags;
create policy "tabshelf_tags_own" on public.tags
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and exists (select 1 from public.categories c
                where c.id = category_id and c.user_id = (select auth.uid()))
  );

drop policy if exists "tabshelf_documents_own" on public.documents;
create policy "tabshelf_documents_own" on public.documents
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "tabshelf_document_tags_own" on public.document_tags;
create policy "tabshelf_document_tags_own" on public.document_tags
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and exists (select 1 from public.documents d
                where d.id = document_id and d.user_id = (select auth.uid()))
    and exists (select 1 from public.tags t
                where t.id = tag_id and t.user_id = (select auth.uid()))
  );

drop policy if exists "tabshelf_collections_own" on public.collections;
create policy "tabshelf_collections_own" on public.collections
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);


-- ---------------------------------------------------------------------
-- 4. FUNZIONI
-- Tutte "security invoker": girano con i permessi di chi le chiama,
-- quindi le regole RLS qui sopra valgono anche al loro interno.
-- ---------------------------------------------------------------------

-- Versione dello schema (l'app la controlla dopo il login)
create or replace function public.tabshelf_schema_version()
returns integer
language sql stable security invoker
set search_path = ''
as $$ select 1 $$;

-- Sostituisce un tag con un altro dentro i filtri delle raccolte
-- (target null = rimuove il tag). Il filtro ha la forma
-- {"include": [id...], "exclude": [id...], "status": [...], "minMastery": n, "sort": "..."}
create or replace function public.tabshelf_replace_tag_in_collections(source uuid, target uuid)
returns void
language plpgsql security invoker
set search_path = ''
as $$
declare
  src text := source::text;
  tgt text := target::text;
begin
  update public.collections c
  set filter = jsonb_set(
    jsonb_set(
      c.filter, '{include}',
      (select coalesce(jsonb_agg(distinct v), '[]'::jsonb)
       from (select case when e = src then tgt else e end as v
             from jsonb_array_elements_text(coalesce(c.filter -> 'include', '[]'::jsonb)) as e) s
       where v is not null)),
    '{exclude}',
    (select coalesce(jsonb_agg(distinct v), '[]'::jsonb)
     from (select case when e = src then tgt else e end as v
           from jsonb_array_elements_text(coalesce(c.filter -> 'exclude', '[]'::jsonb)) as e) s
     where v is not null
       -- un tag incluso non può essere anche escluso
       and not exists (
         select 1 from jsonb_array_elements_text(coalesce(c.filter -> 'include', '[]'::jsonb)) as i
         where (case when i = src then tgt else i end) = v)))
  where c.user_id = (select auth.uid())
    and (coalesce(c.filter -> 'include', '[]'::jsonb) ? src
         or coalesce(c.filter -> 'exclude', '[]'::jsonb) ? src);
end;
$$;

-- Quando un tag viene eliminato DEFINITIVAMENTE (anche insieme alla sua categoria)
-- lo togliamo da tutte le raccolte che lo citano.
create or replace function public.tabshelf_on_tag_delete()
returns trigger
language plpgsql security invoker
set search_path = ''
as $$
begin
  perform public.tabshelf_replace_tag_in_collections(old.id, null);
  return old;
end;
$$;

drop trigger if exists tabshelf_tag_delete_cleanup on public.tags;
create trigger tabshelf_tag_delete_cleanup
  before delete on public.tags
  for each row execute function public.tabshelf_on_tag_delete();

-- Unione di due tag: sposta le associazioni (senza duplicati), aggiorna le
-- raccolte ed elimina definitivamente il tag di partenza. Tutto o niente.
create or replace function public.tabshelf_merge_tags(source uuid, target uuid)
returns integer
language plpgsql security invoker
set search_path = ''
as $$
declare
  moved integer;
begin
  if source = target then
    raise exception 'I due tag sono lo stesso tag';
  end if;
  if not exists (select 1 from public.tags where id = source and user_id = (select auth.uid()))
     or not exists (select 1 from public.tags where id = target and user_id = (select auth.uid())) then
    raise exception 'Tag non trovato';
  end if;

  insert into public.document_tags (document_id, tag_id)
  select dt.document_id, target
  from public.document_tags dt
  where dt.tag_id = source
  on conflict (document_id, tag_id) do nothing;
  get diagnostics moved = row_count;

  perform public.tabshelf_replace_tag_in_collections(source, target);
  delete from public.tags where id = source;   -- le vecchie associazioni spariscono a cascata
  return moved;
end;
$$;

-- Funzione minima per il workflow "keepalive" di GitHub (evita la pausa del
-- progetto). È l'UNICA cosa permessa al ruolo anon: non legge né scrive dati.
create or replace function public.tabshelf_ping()
returns text
language sql stable security invoker
set search_path = ''
as $$ select 'ok'::text $$;

revoke all on function public.tabshelf_schema_version()                       from public, anon;
revoke all on function public.tabshelf_replace_tag_in_collections(uuid, uuid) from public, anon;
revoke all on function public.tabshelf_on_tag_delete()                        from public, anon;
revoke all on function public.tabshelf_merge_tags(uuid, uuid)                 from public, anon;
revoke all on function public.tabshelf_ping()                                 from public;
grant execute on function public.tabshelf_schema_version()                       to authenticated;
grant execute on function public.tabshelf_replace_tag_in_collections(uuid, uuid) to authenticated;
grant execute on function public.tabshelf_merge_tags(uuid, uuid)                 to authenticated;
grant execute on function public.tabshelf_ping()                                 to anon, authenticated;


-- ---------------------------------------------------------------------
-- 5. STORAGE: bucket privato "tabshelf"
-- File in <user_id>/<document_id>/...  — ognuno accede solo alla propria cartella.
-- ---------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('tabshelf', 'tabshelf', false, 52428800,
        array['image/webp', 'image/jpeg', 'image/png', 'application/pdf'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "tabshelf_storage_select" on storage.objects;
create policy "tabshelf_storage_select" on storage.objects
  for select to authenticated
  using (bucket_id = 'tabshelf' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "tabshelf_storage_insert" on storage.objects;
create policy "tabshelf_storage_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'tabshelf' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "tabshelf_storage_update" on storage.objects;
create policy "tabshelf_storage_update" on storage.objects
  for update to authenticated
  using (bucket_id = 'tabshelf' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'tabshelf' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "tabshelf_storage_delete" on storage.objects;
create policy "tabshelf_storage_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'tabshelf' and (storage.foldername(name))[1] = (select auth.uid())::text);


-- ---------------------------------------------------------------------
-- 6. CONTROLLO FINALE: deve restituire una riga con public = false
-- ---------------------------------------------------------------------
select id as bucket, public, file_size_limit
from storage.buckets where id = 'tabshelf';
