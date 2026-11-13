-- Run only in an isolated local PostgreSQL with schema.sql, accounts.sql,
-- goal-setup.sql and wallet.sql installed. All synthetic data rolls back.
\set ON_ERROR_STOP on
begin;
do $$ begin
 assert inet_server_addr() is null and current_setting('port')='55439', 'Use the isolated local socket on port 55439';
end $$;
create temp table wallet_test(actor uuid, other_actor uuid, fineco text, revolut text, token text, stamp text, archive jsonb);
grant select,update on wallet_test to anon,authenticated;
do $$
declare actor uuid:=gen_random_uuid(); other_actor uuid:=gen_random_uuid(); fineco text:=gen_random_uuid()::text; revolut text:=gen_random_uuid()::text; archive jsonb; token text;
begin
 insert into auth.users(id,email) values(actor,'wallet-test@example.invalid'),(other_actor,'wallet-other@example.invalid');
 update public.conto_profiles set status='approved' where user_id in(actor,other_actor);
 archive:=jsonb_build_object('schemaVersion',3,'settings',jsonb_build_object('targetCents',null,'deadline',null),'entries','[]'::jsonb,'accounts',jsonb_build_array(
 jsonb_build_object('id',fineco,'name','Fineco','openingCents',200000,'openingAt','2000-01-01T00:00:00.000Z','currency','EUR','archived',false),
 jsonb_build_object('id',revolut,'name','Revolut','openingCents',50000,'openingAt','2000-01-01T00:00:00.000Z','currency','EUR','archived',false)),'transactions','[]'::jsonb);
 perform set_config('request.jwt.claim.sub',actor::text,true);
 assert public.write_conto_snapshot(0,archive)->>'status'='ok';
 token:=public.conto_wallet_links('create',fineco)->>'token';
 assert length(token)=64;
 assert not exists(select 1 from conto_private.wallet_links where encode(token_hash,'hex')=token),'Codes must be hashed';
 insert into wallet_test values(actor,other_actor,fineco,revolut,token,to_char(now() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),archive);
 assert not has_table_privilege('anon','conto_private.wallet_links','SELECT');
 assert not has_table_privilege('authenticated','conto_private.wallet_links','SELECT');
 assert not has_function_privilege('anon','public.conto_wallet_links(text,text)','EXECUTE');
 assert not has_function_privilege('anon','conto_private.write_snapshot(bigint,jsonb)','EXECUTE');
 assert has_function_privilege('anon','public.conto_wallet_ingest(text,text,text,text,text,text)','EXECUTE');
end $$;
set local role anon;
select set_config('request.jwt.claim.sub','',true);
do $$
declare c record; result jsonb;
begin
 select * into c from wallet_test;
 result:=public.conto_wallet_ingest(c.token,'payment-1','25,50','Supermercato','EUR',c.stamp);
 assert result='{"status":"ok"}'::jsonb,'Ingest must return no balances or identity';
 assert public.conto_wallet_ingest(c.token,'payment-1','25.50','Supermercato','EUR',c.stamp)->>'status'='duplicate';
 begin perform public.conto_wallet_ingest(c.token,'payment-1','26','Supermercato','EUR',c.stamp); raise exception 'ID conflict accepted'; exception when invalid_parameter_value then null; end;
 begin perform public.conto_wallet_ingest(repeat('0',64),'invalid','5','Test','EUR',c.stamp); raise exception 'Invalid code accepted'; exception when insufficient_privilege then null; end;
 begin perform public.conto_wallet_ingest(c.token,'negative','-5','Test','EUR',c.stamp); raise exception 'Negative expense accepted'; exception when invalid_parameter_value then null; end;
 begin perform public.conto_wallet_ingest(c.token,'foreign','5','Test','USD',c.stamp); raise exception 'Foreign currency accepted'; exception when invalid_parameter_value then null; end;
 begin perform public.conto_wallet_ingest(c.token,'grouped','1.000,50','Test','EUR',c.stamp); raise exception 'Ambiguous amount accepted'; exception when invalid_parameter_value then null; end;
 begin perform public.conto_wallet_links('create',c.revolut); raise exception 'Anon management allowed'; exception when insufficient_privilege then null; end;
 begin perform payload from public.conto_snapshots; raise exception 'Anon read allowed'; exception when insufficient_privilege then null; end;
end $$;
reset role;
do $$
declare c record; archive jsonb; result jsonb;
begin
 select * into c from wallet_test;
 select payload into archive from public.conto_snapshots where user_id=c.actor;
 assert jsonb_array_length(archive->'transactions')=1,'Replay must not double charge';
 assert archive->'transactions'->0->>'accountId'=c.fineco;
 assert (archive->'transactions'->0->>'amountCents')::int=-2550;
 assert archive->'accounts'->1->>'openingCents'='50000','Other account unchanged';
 assert conto_private.payload_is_valid(archive);
 archive:=jsonb_set(archive,'{entries}',jsonb_build_array(jsonb_build_object('month',to_char(c.stamp::timestamptz at time zone 'Europe/Rome','YYYY-MM'),'balanceCents',250000,'note','','verifiedAt',c.stamp,'accountBalances',jsonb_build_array(jsonb_build_object('accountId',c.fineco,'name','Fineco','balanceCents',200000),jsonb_build_object('accountId',c.revolut,'name','Revolut','balanceCents',50000)))));
 assert conto_private.payload_is_valid(archive),'Monthly account snapshots must be accepted';
 assert not conto_private.payload_is_valid(jsonb_set(archive,'{entries,0,balanceCents}','1'::jsonb)),'Snapshot sum mismatch must be rejected';
 assert not conto_private.payload_is_valid(jsonb_set(archive,'{entries,0,accountBalances,1,accountId}',to_jsonb(c.fineco))),'Duplicate monthly accounts must be rejected';

 perform set_config('request.jwt.claim.sub',c.actor::text,true);
 assert public.write_conto_snapshot(1,c.archive)->>'status'='conflict','Payment must invalidate stale snapshot writes';
 assert public.write_conto_snapshot(2,(c.archive-'accounts'-'transactions')||'{"schemaVersion":2}'::jsonb)->>'status'='update-required','Old clients cannot remove accounts';
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub',(select other_actor::text from wallet_test),true);
do $$ declare c record; begin
 select * into c from wallet_test;
 assert (select count(*) from public.conto_snapshots)=0,'Other user must not read owner archive';
 assert public.conto_wallet_links('list')->'links'='[]'::jsonb,'Other user must not list owner links';
 begin perform public.conto_wallet_links('create',c.fineco); raise exception 'Other user linked owner account'; exception when invalid_parameter_value then null; end;
 perform public.conto_wallet_links('revoke',c.fineco);
end $$;
reset role;
do $$ declare c record; fresh text; archive jsonb; begin
 select * into c from wallet_test;
 assert public.conto_wallet_ingest(c.token,'payment-2','10','Test','EUR',c.stamp)->>'status'='ok','Other user cannot revoke owner token';
 perform set_config('request.jwt.claim.sub',c.actor::text,true);
 -- Restoring a backup must not let a retried already-received event reappear.
 assert public.write_conto_snapshot(3,c.archive)->>'status'='ok';
 assert public.conto_wallet_ingest(c.token,'payment-1','25.50','Supermercato','EUR',c.stamp)->>'status'='duplicate';
 assert (select jsonb_array_length(payload->'transactions') from public.conto_snapshots where user_id=c.actor)=0;
 fresh:=public.conto_wallet_links('create',c.fineco)->>'token';
 begin perform public.conto_wallet_ingest(c.token,'revoked','10','Test','EUR',c.stamp); raise exception 'Rotated token accepted'; exception when insufficient_privilege then null; end;
 update public.conto_profiles set status='blocked' where user_id=c.actor;
 begin perform public.conto_wallet_ingest(fresh,'blocked','10','Test','EUR',c.stamp); raise exception 'Blocked user accepted'; exception when insufficient_privilege then null; end;
 update public.conto_profiles set status='approved' where user_id=c.actor;
 perform public.conto_wallet_links('revoke',c.fineco);
 begin perform public.conto_wallet_ingest(fresh,'revoked','10','Test','EUR',c.stamp); raise exception 'Revoked token accepted'; exception when insufficient_privilege then null; end;
end $$;
select 'Wallet database checks passed: isolation, validation, replay, CAS, downgrade, revocation, blocked users and restore' as result;
rollback;
