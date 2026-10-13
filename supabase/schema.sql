-- MLAZ platform: shared data store. Run once in the Supabase dashboard → SQL Editor (safe to run again).

-- Every member, application, payment, event, announcement and audit entry is one row, keyed by collection and ID.
-- `ver` goes up on every change so two people editing the same record can't silently overwrite each other.
create table if not exists public.records (
  kind text not null,
  key text not null,
  data jsonb not null,
  ord double precision not null default 0,
  ver integer not null default 1,
  updated_at timestamptz not null default now(),
  primary key (kind, key)
);

-- PROTOTYPE ACCESS: the app has no real sign-in yet, so anyone with the site's public key can read and change
-- every record and document. Replace these policies with ones based on Supabase Auth before using real applicant data.
alter table public.records enable row level security;
drop policy if exists "prototype full access" on public.records;
create policy "prototype full access" on public.records for all to anon, authenticated using (true) with check (true);

-- Applies a batch of changes in one transaction. An update or delete only succeeds if the row is still at the version the
-- browser last saw, and an insert fails if the ID is taken; either way nothing in the batch is saved (error 40001 / 23505).
create or replace function public.apply_changes(changes jsonb) returns integer[]
language plpgsql as $$
declare
  c jsonb;
  v integer;
  vers integer[] := '{}';
begin
  for c in select * from jsonb_array_elements(changes) loop
    v := null;
    if c->>'op' = 'insert' then
      insert into public.records (kind, key, data, ord)
        values (c->>'kind', c->>'key', c->'data', (c->>'ord')::double precision)
        returning ver into v;
    elsif c->>'op' = 'update' then
      update public.records set data = c->'data', ver = ver + 1, updated_at = now()
        where kind = c->>'kind' and key = c->>'key' and ver = (c->>'ver')::integer
        returning ver into v;
      if v is null then raise exception 'Record %/% was changed by someone else', c->>'kind', c->>'key' using errcode = '40001'; end if;
    elsif c->>'op' = 'delete' then
      delete from public.records
        where kind = c->>'kind' and key = c->>'key' and ver = (c->>'ver')::integer
        returning ver into v;
      if v is null then raise exception 'Record %/% was changed by someone else', c->>'kind', c->>'key' using errcode = '40001'; end if;
      v := null;
    end if;
    vers := array_append(vers, v);
  end loop;
  return vers;
end $$;

grant execute on function public.apply_changes(jsonb) to anon, authenticated;

-- Live updates: every open browser is told when a record changes.
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'records') then
    alter publication supabase_realtime add table public.records;
  end if;
end $$;

-- Uploaded documents (MoF authorizations, PACRA certificates, NRCs, proofs of payment). Same prototype access as above.
insert into storage.buckets (id, name, public) values ('docs', 'docs', false) on conflict (id) do nothing;
drop policy if exists "prototype docs access" on storage.objects;
create policy "prototype docs access" on storage.objects for all to anon, authenticated
  using (bucket_id = 'docs') with check (bucket_id = 'docs');
