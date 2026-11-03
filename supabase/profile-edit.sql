-- Only the signed-in, approved owner can edit their profile fields.
create or replace function conto_private.my_account() returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('user_id',p.user_id,'status',p.status,'is_admin',p.is_admin,
 'first_name',p.first_name,'last_name',p.last_name,'phone',p.phone,
 'username',coalesce(u.raw_app_meta_data->>'login_username',''),'email',u.email,
 'pending_email',coalesce(u.email_change,''))
 from public.conto_profiles p join auth.users u on u.id=p.user_id where p.user_id=auth.uid()
$$;
create or replace function conto_private.update_profile(p_first_name text,p_last_name text,p_phone text,p_username text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); alias text:=lower(trim(coalesce(p_username,'')));
begin
 if actor is null or not conto_private.account_active() then raise exception 'Account not approved' using errcode='42501'; end if;
 if p_first_name is null or p_last_name is null or p_phone is null
 or length(trim(p_first_name))>80 or length(trim(p_last_name))>80
 or (trim(p_phone)<>'' and trim(p_phone)!~'^[+0-9() .-]{6,30}$')
 or (alias<>'' and alias!~'^[a-z0-9_.-]{3,32}$') then
 raise exception 'Invalid profile' using errcode='22023'; end if;
 perform pg_catalog.pg_advisory_xact_lock(745031,1);
 if alias<>'' and exists(select 1 from auth.users where id<>actor and lower(raw_app_meta_data->>'login_username')=alias) then
 raise exception 'Username unavailable' using errcode='23505'; end if;
 update public.conto_profiles set first_name=trim(p_first_name),last_name=trim(p_last_name),phone=trim(p_phone) where user_id=actor;
 update auth.users set raw_app_meta_data=case when alias='' then coalesce(raw_app_meta_data,'{}'::jsonb)-'login_username'
 else jsonb_set(coalesce(raw_app_meta_data,'{}'::jsonb),'{login_username}',to_jsonb(alias)) end where id=actor;
 return conto_private.my_account();
end $$;
create or replace function public.conto_update_profile(p_first_name text,p_last_name text,p_phone text,p_username text) returns jsonb
language sql security invoker set search_path='' as $$
 select conto_private.update_profile(p_first_name,p_last_name,p_phone,p_username)
$$;
revoke all on function conto_private.update_profile(text,text,text,text),public.conto_update_profile(text,text,text,text) from public,anon,authenticated;
grant execute on function conto_private.update_profile(text,text,text,text),public.conto_update_profile(text,text,text,text) to authenticated;
