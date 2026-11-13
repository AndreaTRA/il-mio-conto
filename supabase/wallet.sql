-- Multi-account archive and account-scoped, write-only Apple Pay ingestion.
-- No bank credentials. Codes are hashed; secrets never enter backups.
do $$ begin
 if to_regprocedure('conto_private.payload_v2_is_valid(jsonb)') is null then
  alter function conto_private.payload_is_valid(jsonb) rename to payload_v2_is_valid;
 end if;
end $$;

create or replace function conto_private.wallet_instant(p text) returns boolean
language plpgsql immutable set search_path='' as $$
begin
 return p is not null and p ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$'
 and left(p,4) >= '0001' and to_char(p::timestamptz at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')=p;
exception when others then return false;
end $$;
revoke all on function conto_private.wallet_instant(text) from public,anon,authenticated;

create or replace function conto_private.payload_is_valid(p_payload jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
declare a jsonb; t jsonb; e jsonb; b jsonb; total numeric; seen text[]; amount numeric; ids text[] := '{}'; txids text[] := '{}'; idpattern text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
begin
 if p_payload->'schemaVersion' = '2'::jsonb then return conto_private.payload_v2_is_valid(p_payload); end if;
 if p_payload->'schemaVersion' is distinct from '3'::jsonb or not conto_private.payload_v2_is_valid(p_payload || '{"schemaVersion":2}'::jsonb)
 or jsonb_typeof(p_payload->'accounts') is distinct from 'array' or jsonb_typeof(p_payload->'transactions') is distinct from 'array' then return false; end if;
 if jsonb_array_length(p_payload->'accounts')>100 or jsonb_array_length(p_payload->'transactions')>10000 then return false; end if;
 for e in select value from jsonb_array_elements(p_payload->'entries') loop
  if e ? 'verifiedAt' or e ? 'accountBalances' then
   if not conto_private.wallet_instant(e->>'verifiedAt') or to_char((e->>'verifiedAt')::timestamptz at time zone 'Europe/Rome','YYYY-MM')<>e->>'month'
    or jsonb_typeof(e->'accountBalances') is distinct from 'array' then return false; end if;
   if jsonb_array_length(e->'accountBalances') not between 1 and 100 then return false; end if;
   total:=0; seen:='{}';
   for b in select value from jsonb_array_elements(e->'accountBalances') loop
    if jsonb_typeof(b->'accountId') is distinct from 'string' or b->>'accountId' !~ idpattern or b->>'accountId'=any(seen)
     or jsonb_typeof(b->'name') is distinct from 'string' or length(trim(b->>'name')) not between 1 and 60
     or jsonb_typeof(b->'balanceCents') is distinct from 'number' then return false; end if;
    amount:=(b->>'balanceCents')::numeric;
    if amount<>trunc(amount) or abs(amount)>100000000000 then return false; end if;
    total:=total+amount; seen:=array_append(seen,b->>'accountId');
   end loop;
   if e->'balanceCents'='null'::jsonb or total<>(e->>'balanceCents')::numeric then return false; end if;
  end if;
 end loop;
 for a in select value from jsonb_array_elements(p_payload->'accounts') loop
  if jsonb_typeof(a->'id') is distinct from 'string' or a->>'id' !~ idpattern or a->>'id'=any(ids)
  or jsonb_typeof(a->'name') is distinct from 'string' or length(trim(a->>'name')) not between 1 and 60
  or jsonb_typeof(a->'openingCents') is distinct from 'number' or not conto_private.wallet_instant(a->>'openingAt')
  or a->>'currency' is distinct from 'EUR' or jsonb_typeof(a->'archived') is distinct from 'boolean' then return false; end if;
  amount := (a->>'openingCents')::numeric;
  if amount<>trunc(amount) or abs(amount)>100000000000 then return false; end if;
  ids := array_append(ids,a->>'id');
 end loop;
 for t in select value from jsonb_array_elements(p_payload->'transactions') loop
  if jsonb_typeof(t->'id') is distinct from 'string' or t->>'id' !~ idpattern or t->>'id'=any(txids)
  or jsonb_typeof(t->'accountId') is distinct from 'string' or not (t->>'accountId'=any(ids))
  or jsonb_typeof(t->'amountCents') is distinct from 'number' or not conto_private.wallet_instant(t->>'occurredAt')
  or jsonb_typeof(t->'merchant') is distinct from 'string' or length(t->>'merchant')>140
  or t->>'source' is null or t->>'source' not in ('manual','apple-pay') or jsonb_typeof(t->'voided') is distinct from 'boolean' then return false; end if;
  amount := (t->>'amountCents')::numeric;
  if amount<>trunc(amount) or amount=0 or abs(amount)>100000000000 or (t->>'source'='apple-pay' and amount>0) then return false; end if;
  txids := array_append(txids,t->>'id');
 end loop;
 for a in select value from jsonb_array_elements(p_payload->'accounts') loop
  select (a->>'openingCents')::numeric + coalesce(sum((value->>'amountCents')::numeric),0) into amount
   from jsonb_array_elements(p_payload->'transactions') where value->>'accountId'=a->>'id' and value->'voided'='false'::jsonb and value->>'occurredAt'>a->>'openingAt';
  if abs(amount)>100000000000 then return false; end if;
 end loop;
 return true;
exception when others then return false;
end $$;
revoke all on function conto_private.payload_is_valid(jsonb) from public,anon,authenticated;

create or replace function conto_private.write_snapshot(p_expected_version bigint,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); existing public.conto_snapshots%rowtype; written bigint;
begin
 if actor is null or not conto_private.account_active() then raise exception 'Account not approved' using errcode='42501'; end if;
 if p_expected_version is null or p_expected_version<0 or p_expected_version>=9007199254740991 or not conto_private.payload_is_valid(p_payload) then raise exception 'Invalid archive' using errcode='22023'; end if;
 select * into existing from public.conto_snapshots where user_id=actor for update;
 if found then
  if existing.version<>p_expected_version then return jsonb_build_object('status','conflict'); end if;
  if existing.payload->'schemaVersion'='3'::jsonb and p_payload->'schemaVersion'<>'3'::jsonb then return jsonb_build_object('status','update-required'); end if;
  update public.conto_snapshots set payload=p_payload,version=version+1,updated_at=now() where user_id=actor returning version into written;
 else
  if p_expected_version<>0 then return jsonb_build_object('status','conflict'); end if;
  insert into public.conto_snapshots(user_id,version,payload) values(actor,1,p_payload) on conflict do nothing returning version into written;
 end if;
 if written is null then return jsonb_build_object('status','conflict'); end if;
 return jsonb_build_object('status','ok','version',written);
end $$;
revoke all on function conto_private.write_snapshot(bigint,jsonb) from public,anon,authenticated;
grant execute on function conto_private.write_snapshot(bigint,jsonb) to authenticated;

create table if not exists conto_private.wallet_links (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 account_id text not null, token_hash bytea not null unique, created_at timestamptz not null default now(), revoked_at timestamptz
);
alter table conto_private.wallet_links enable row level security;
revoke all on conto_private.wallet_links from public,anon,authenticated;
create index if not exists wallet_links_owner on conto_private.wallet_links(user_id,account_id);
create table if not exists conto_private.wallet_receipts (
 link_id uuid not null references conto_private.wallet_links(id) on delete cascade,
 event_id text not null check(length(event_id) between 1 and 128), fingerprint bytea not null, created_at timestamptz not null default now(), primary key(link_id,event_id)
);
alter table conto_private.wallet_receipts enable row level security;
revoke all on conto_private.wallet_receipts from public,anon,authenticated;

create or replace function conto_private.wallet_links_manage(p_action text,p_account_id text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); secret text; result jsonb; archive jsonb;
begin
 if actor is null or not conto_private.account_active() then raise exception 'Account not approved' using errcode='42501'; end if;
 -- Serialize with ingestion and snapshot saves; ownership never comes from input.
 select payload into archive from public.conto_snapshots where user_id=actor for update;
 if p_action='create' then
  if archive->'schemaVersion' is distinct from '3'::jsonb or not exists(select 1 from jsonb_array_elements(archive->'accounts') a where a->>'id'=p_account_id and a->'archived'='false'::jsonb) then raise exception 'Sync account first' using errcode='22023'; end if;
  update conto_private.wallet_links set revoked_at=now() where user_id=actor and account_id=p_account_id and revoked_at is null;
  secret:=replace(gen_random_uuid()::text||gen_random_uuid()::text,'-','');
  insert into conto_private.wallet_links(user_id,account_id,token_hash) values(actor,p_account_id,sha256(convert_to(secret,'UTF8')));
 elsif p_action='revoke' then
  update conto_private.wallet_links set revoked_at=now() where user_id=actor and account_id=p_account_id and revoked_at is null;
 elsif p_action<>'list' or p_action is null then raise exception 'Invalid action' using errcode='22023';
 end if;
 select coalesce(jsonb_agg(jsonb_build_object('accountId',account_id,'createdAt',created_at) order by created_at),'[]'::jsonb) into result from conto_private.wallet_links where user_id=actor and revoked_at is null;
 return jsonb_build_object('links',result,'token',secret);
end $$;
create or replace function public.conto_wallet_links(p_action text,p_account_id text default null) returns jsonb
language sql security invoker set search_path='' as $$ select conto_private.wallet_links_manage(p_action,p_account_id) $$;
revoke all on function conto_private.wallet_links_manage(text,text), public.conto_wallet_links(text,text) from public,anon,authenticated;
grant execute on function conto_private.wallet_links_manage(text,text), public.conto_wallet_links(text,text) to authenticated;

-- Possession of a random account-scoped code authorizes expense submission only.
-- No archive, balance, user ID or card data is returned to the caller.
create or replace function conto_private.wallet_ingest(p_token text,p_event_id text,p_amount text,p_merchant text,p_currency text,p_occurred_at text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare link conto_private.wallet_links%rowtype; snapshot public.conto_snapshots%rowtype; stamp text; amount bigint; transaction jsonb; next jsonb; fingerprint bytea; receipt bytea; existing jsonb; movement_id uuid;
begin
 if p_token is null or p_token !~ '^[0-9a-f]{64}$' then raise exception 'Invalid connection' using errcode='42501'; end if;
 select * into link from conto_private.wallet_links where token_hash=sha256(convert_to(p_token,'UTF8')) and revoked_at is null;
 if not found then raise exception 'Invalid connection' using errcode='42501'; end if;
 select * into snapshot from public.conto_snapshots where user_id=link.user_id for update;
 -- Re-check after acquiring the snapshot lock, so revocation wins races.
 if not exists(select 1 from conto_private.wallet_links where id=link.id and revoked_at is null)
 or not exists(select 1 from public.conto_profiles where user_id=link.user_id and status='approved') then raise exception 'Invalid connection' using errcode='42501'; end if;
 if snapshot.payload->'schemaVersion' is distinct from '3'::jsonb or not exists(select 1 from jsonb_array_elements(snapshot.payload->'accounts') a where a->>'id'=link.account_id and a->'archived'='false'::jsonb) then raise exception 'Account unavailable' using errcode='22023'; end if;
 if p_event_id is null or length(p_event_id) not between 1 and 128 or p_currency is distinct from 'EUR' or p_amount is null or length(p_amount)>20 or p_amount !~ '^[0-9]+([.,][0-9]{1,2})?$' or p_merchant is null or length(p_merchant)>140 then raise exception 'Invalid payment: use EUR, amount without grouping, merchant and event ID' using errcode='22023'; end if;
 amount:=(replace(p_amount,',','.')::numeric*100)::bigint;
 if amount<=0 or amount>100000000000 then raise exception 'Invalid amount' using errcode='22023'; end if;
 if p_occurred_at is null or p_occurred_at !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,3})?(Z|[+-][0-9]{2}:[0-9]{2})$' or p_occurred_at::timestamptz>now()+interval '5 minutes' then raise exception 'Invalid UTC timestamp' using errcode='22023'; end if;
 stamp:=to_char(p_occurred_at::timestamptz at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
 movement_id:=substr(encode(sha256(convert_to(link.account_id||':'||p_event_id,'UTF8')),'hex'),1,32)::uuid;
 fingerprint:=sha256(convert_to(jsonb_build_array(link.account_id,amount,p_merchant,p_currency,stamp)::text,'UTF8'));
 select r.fingerprint into receipt from conto_private.wallet_receipts r where r.link_id=link.id and event_id=p_event_id;
 if found then
  if receipt<>fingerprint then raise exception 'Event ID reused with different data' using errcode='22023'; end if;
  return jsonb_build_object('status','duplicate');
 end if;
 transaction:=jsonb_build_object('id',movement_id,'accountId',link.account_id,'amountCents',-amount,'occurredAt',stamp,'merchant',p_merchant,'source','apple-pay','voided',false);
 select value into existing from jsonb_array_elements(snapshot.payload->'transactions') where value->>'id'=movement_id::text;
 if found then
  if (existing-'voided')<>(transaction-'voided') then raise exception 'Event ID already used' using errcode='22023'; end if;
  insert into conto_private.wallet_receipts(link_id,event_id,fingerprint) values(link.id,p_event_id,fingerprint);
  return jsonb_build_object('status','duplicate');
 end if;
 if (select count(*) from conto_private.wallet_receipts where link_id=link.id and created_at>now()-interval '1 hour')>=120 then raise exception 'Too many payments, retry later' using errcode='54000'; end if;
 next:=jsonb_set(snapshot.payload,'{transactions}',snapshot.payload->'transactions'||jsonb_build_array(transaction));
 if not conto_private.payload_is_valid(next) then raise exception 'Archive limit reached' using errcode='22023'; end if;
 insert into conto_private.wallet_receipts(link_id,event_id,fingerprint) values(link.id,p_event_id,fingerprint);
 update public.conto_snapshots set payload=next,version=version+1,updated_at=now() where user_id=link.user_id;
 return jsonb_build_object('status','ok');
end $$;
create or replace function public.conto_wallet_ingest(p_token text,p_event_id text,p_amount text,p_merchant text,p_currency text,p_occurred_at text) returns jsonb
language sql security invoker set search_path='' as $$ select conto_private.wallet_ingest(p_token,p_event_id,p_amount,p_merchant,p_currency,p_occurred_at) $$;
revoke all on function conto_private.wallet_ingest(text,text,text,text,text,text),public.conto_wallet_ingest(text,text,text,text,text,text) from public,anon,authenticated;
grant usage on schema conto_private to anon;
grant execute on function conto_private.wallet_ingest(text,text,text,text,text,text),public.conto_wallet_ingest(text,text,text,text,text,text) to anon,authenticated;
