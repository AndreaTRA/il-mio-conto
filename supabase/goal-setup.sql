-- Allow an explicitly unset goal; partial or invalid goals remain rejected.
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
    or not ((p_payload->'settings'->'targetCents' = 'null'::jsonb and p_payload->'settings'->'deadline' = 'null'::jsonb)
      or (pg_catalog.jsonb_typeof(p_payload->'settings'->'targetCents') = 'number' and pg_catalog.jsonb_typeof(p_payload->'settings'->'deadline') = 'string'))
    or not (p_payload->'settings' ? 'targetCents' and p_payload->'settings' ? 'deadline')
    or pg_catalog.jsonb_typeof(p_payload->'entries') is distinct from 'array'
  then return false; end if;
  if pg_catalog.octet_length(p_payload::text) > 10000000
    or pg_catalog.jsonb_array_length(p_payload->'entries') > 119988
  then return false; end if;
  if p_payload->'settings' ? 'goalChosen' and pg_catalog.jsonb_typeof(p_payload->'settings'->'goalChosen') <> 'boolean' then return false; end if;
  if p_payload->'settings' ? 'reminderDay' then
    if pg_catalog.jsonb_typeof(p_payload->'settings'->'reminderDay') <> 'number' then return false; end if;
    amount := (p_payload->'settings'->>'reminderDay')::numeric;
    if amount <> pg_catalog.trunc(amount) or amount < 1 or amount > 31 then return false; end if;
  end if;
  if p_payload->'settings'->'targetCents' = 'null'::jsonb and p_payload->'settings'->'goalChosen' = 'true'::jsonb then return false; end if;
  if p_payload->'settings'->'targetCents' <> 'null'::jsonb then
  amount := (p_payload->'settings'->>'targetCents')::numeric;
  if amount <> pg_catalog.trunc(amount) or amount <= 0 or amount > 100000000000 then return false; end if;
  due := p_payload->'settings'->>'deadline';
  if due !~ '^[0-9]{4}-(0[1-9]|1[0-2])-[0-9]{2}$'
    or due::date::text <> due then return false; end if;
  end if;
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

