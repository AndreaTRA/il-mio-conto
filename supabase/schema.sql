-- Il mio conto: one private archive per authenticated user.
-- Run once in a dedicated Supabase project. No financial data or secrets here.

create schema if not exists conto_private;
revoke all on schema conto_private from public, anon, authenticated;
grant usage on schema conto_private to authenticated;
grant usage on schema public to authenticated;

create table if not exists public.conto_snapshots (
  user_id uuid primary key references auth.users(id) on delete cascade,
  version bigint not null check (version between 1 and 9007199254740991),
  payload jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.conto_snapshots enable row level security;
revoke all on table public.conto_snapshots from public, anon, authenticated;
grant select on table public.conto_snapshots to authenticated;

drop policy if exists conto_owner_can_read on public.conto_snapshots;
create policy conto_owner_can_read on public.conto_snapshots
  for select to authenticated
  using ((select auth.uid()) = user_id);

-- All writes use the version-checked RPC below. Direct client writes are denied.
create or replace function conto_private.payload_is_valid(p_payload jsonb)
returns boolean
language plpgsql immutable
set search_path = ''
set datestyle = 'ISO, YMD'
as $$
declare
  e jsonb;
  due text;
  amount numeric;
begin
  if pg_catalog.jsonb_typeof(p_payload) is distinct from 'object'
    or p_payload->'schemaVersion' is distinct from '2'::jsonb
    or pg_catalog.jsonb_typeof(p_payload->'settings') is distinct from 'object'
    or pg_catalog.jsonb_typeof(p_payload->'settings'->'targetCents') is distinct from 'number'
    or pg_catalog.jsonb_typeof(p_payload->'settings'->'deadline') is distinct from 'string'
    or pg_catalog.jsonb_typeof(p_payload->'entries') is distinct from 'array'
  then return false; end if;
  if pg_catalog.octet_length(p_payload::text) > 10000000
    or pg_catalog.jsonb_array_length(p_payload->'entries') > 119988
  then return false; end if;
  amount := (p_payload->'settings'->>'targetCents')::numeric;
  if amount <> pg_catalog.trunc(amount) or amount <= 0 or amount > 100000000000 then return false; end if;
  due := p_payload->'settings'->>'deadline';
  if due !~ '^[0-9]{4}-(0[1-9]|1[0-2])-[0-9]{2}$'
    or due::date::text <> due then return false; end if;
  for e in select value from pg_catalog.jsonb_array_elements(p_payload->'entries') loop
    if pg_catalog.jsonb_typeof(e) is distinct from 'object'
      or pg_catalog.jsonb_typeof(e->'month') is distinct from 'string'
      or e->>'month' !~ '^[0-9]{4}-(0[1-9]|1[0-2])$'
      or (e->>'month') < '0001-01'
      or pg_catalog.jsonb_typeof(e->'note') is distinct from 'string'
      or pg_catalog.length(e->>'note') > 500
      or not (e ? 'balanceCents')
    then return false; end if;
    if e->'balanceCents' is distinct from 'null'::jsonb then
      if pg_catalog.jsonb_typeof(e->'balanceCents') is distinct from 'number' then return false; end if;
      amount := (e->>'balanceCents')::numeric;
      if amount <> pg_catalog.trunc(amount) or pg_catalog.abs(amount) > 100000000000 then return false; end if;
    end if;
  end loop;
  if (select pg_catalog.count(distinct value->>'month') from pg_catalog.jsonb_array_elements(p_payload->'entries'))
     <> pg_catalog.jsonb_array_length(p_payload->'entries') then return false; end if;
  return true;
exception
  when invalid_text_representation or datetime_field_overflow or numeric_value_out_of_range then return false;
end;
$$;
revoke all on function conto_private.payload_is_valid(jsonb) from public, anon, authenticated;

-- A definer function is used only to restrict writes to this CAS operation.
-- It accepts no user_id argument: ownership always comes from the verified JWT.
create or replace function conto_private.write_snapshot(p_expected_version bigint, p_payload jsonb)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  written_version bigint;
begin
  if actor is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if p_expected_version is null or p_expected_version < 0 or p_expected_version >= 9007199254740991
    or not conto_private.payload_is_valid(p_payload)
  then raise exception 'Invalid archive' using errcode = '22023'; end if;
  if p_expected_version = 0 then
    insert into public.conto_snapshots(user_id, version, payload, updated_at)
    values (actor, 1, p_payload, pg_catalog.now())
    on conflict (user_id) do nothing
    returning version into written_version;
  else
    update public.conto_snapshots
      set payload = p_payload, version = version + 1, updated_at = pg_catalog.now()
      where user_id = actor and version = p_expected_version
      returning version into written_version;
  end if;
  if written_version is null then return pg_catalog.jsonb_build_object('status', 'conflict'); end if;
  return pg_catalog.jsonb_build_object('status', 'ok', 'version', written_version);
end;
$$;
revoke all on function conto_private.write_snapshot(bigint, jsonb) from public, anon, authenticated;
grant execute on function conto_private.write_snapshot(bigint, jsonb) to authenticated;

-- Only the invoker wrapper is exposed through the Data API. The privileged
-- implementation stays in the unexposed schema and validates auth.uid itself.
create or replace function public.write_conto_snapshot(p_expected_version bigint, p_payload jsonb)
returns jsonb
language sql security invoker
set search_path = ''
as $$ select conto_private.write_snapshot(p_expected_version, p_payload); $$;
revoke all on function public.write_conto_snapshot(bigint, jsonb) from public, anon, authenticated;
grant execute on function public.write_conto_snapshot(bigint, jsonb) to authenticated;
