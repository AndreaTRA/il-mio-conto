-- Account approval. Existing archives are never rewritten by this migration.
create table if not exists public.conto_profiles (
 user_id uuid primary key references auth.users(id) on delete cascade,
 first_name text not null default '' check(length(first_name)<=80),
 last_name text not null default '' check(length(last_name)<=80),
 phone text not null default '' check(length(phone)<=30),
 status text not null default 'pending' check(status in ('pending','approved','rejected','blocked')),
 is_admin boolean not null default false,
 created_at timestamptz not null default now()
);
alter table public.conto_profiles enable row level security;
revoke all on public.conto_profiles from public, anon, authenticated;

create or replace function conto_private.account_active() returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.conto_profiles where user_id=auth.uid() and status='approved')
$$;
revoke all on function conto_private.account_active() from public, anon;
grant execute on function conto_private.account_active() to authenticated;

create or replace function conto_private.create_profile() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 insert into public.conto_profiles(user_id,first_name,last_name,phone)
 values(new.id,left(coalesce(new.raw_user_meta_data->>'first_name',''),80),left(coalesce(new.raw_user_meta_data->>'last_name',''),80),left(coalesce(new.raw_user_meta_data->>'phone',''),30));
 return new;
end $$;
revoke all on function conto_private.create_profile() from public, anon, authenticated;
drop trigger if exists conto_profile_created on auth.users;
create trigger conto_profile_created after insert on auth.users for each row execute function conto_private.create_profile();
insert into public.conto_profiles(user_id) select id from auth.users on conflict do nothing;
-- Verified existing owner. Never derive this privilege from signup metadata.
update public.conto_profiles set status='approved',is_admin=true where user_id='62cf7f08-2c29-47cc-b4ab-6d1298c4a14c';

create or replace function conto_private.my_account() returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('user_id',user_id,'status',status,'is_admin',is_admin,'first_name',first_name,'last_name',last_name,'phone',phone)
 from public.conto_profiles where user_id=auth.uid()
$$;
create or replace function public.conto_my_account() returns jsonb
language sql security invoker set search_path='' as $$ select conto_private.my_account() $$;

create or replace function conto_private.manage_accounts(p_user_id uuid default null,p_status text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from public.conto_profiles where user_id=auth.uid() and is_admin and status='approved') then
 raise exception 'Administrator required' using errcode='42501'; end if;
 if p_user_id is not null then
  if p_status is null or p_status not in ('approved','rejected','blocked') then raise exception 'Invalid status' using errcode='22023'; end if;
  update public.conto_profiles set status=p_status where user_id=p_user_id and not is_admin and user_id<>auth.uid();
  if not found then raise exception 'Account cannot be changed' using errcode='22023'; end if;
 end if;
 return (select coalesce(jsonb_agg(row_to_json(a) order by a.created_at desc),'[]'::jsonb) from
 (select p.*,u.email,u.email_confirmed_at is not null as email_confirmed from public.conto_profiles p join auth.users u on u.id=p.user_id) a);
end $$;
create or replace function public.conto_manage_accounts(p_user_id uuid default null,p_status text default null) returns jsonb
language sql security invoker set search_path='' as $$ select conto_private.manage_accounts(p_user_id,p_status) $$;
revoke all on function conto_private.my_account(), public.conto_my_account(), conto_private.manage_accounts(uuid,text), public.conto_manage_accounts(uuid,text) from public,anon,authenticated;
grant execute on function conto_private.my_account(), public.conto_my_account(), conto_private.manage_accounts(uuid,text), public.conto_manage_accounts(uuid,text) to authenticated;

drop policy if exists conto_owner_can_read on public.conto_snapshots;
create policy conto_owner_can_read on public.conto_snapshots for select to authenticated
 using ((select auth.uid())=user_id and (select conto_private.account_active()));

create or replace function conto_private.write_snapshot(p_expected_version bigint, p_payload jsonb)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  written_version bigint;
begin
  if not conto_private.account_active() then raise exception 'Account not approved' using errcode = '42501'; end if;
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

