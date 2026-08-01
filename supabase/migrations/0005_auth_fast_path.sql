-- Fast, atomic authentication path. Run after 0004 in Supabase SQL Editor.
create or replace function public.fala_auth_preflight(p_email text, p_ip text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  email_key text := lower(p_email) || ':auth-login';
  ip_key text := lower(coalesce(nullif(p_ip, ''), 'unknown')) || ':auth-login';
  email_count integer := 0;
  ip_count integer := 0;
  email_locked timestamptz;
  ip_locked timestamptz;
  row_data record;
begin
  for row_data in select key from (values (email_key, 10), (ip_key, 30)) as keys(key, max_count) loop
    insert into public.rate_limits(key, window_start, count) values (row_data.key, now(), 1)
    on conflict (key) do update set
      window_start = case when public.rate_limits.window_start < now() - interval '15 minutes' then now() else public.rate_limits.window_start end,
      count = case when public.rate_limits.window_start < now() - interval '15 minutes' then 1 else public.rate_limits.count + 1 end;
  end loop;
  select count into email_count from public.rate_limits where key = email_key;
  select count into ip_count from public.rate_limits where key = ip_key;
  select locked_until into email_locked from public.auth_login_failures where lower(identity) = lower(p_email);
  select locked_until into ip_locked from public.auth_login_failures where lower(identity) = lower('ip:' || coalesce(nullif(p_ip, ''), 'unknown'));
  return jsonb_build_object(
    'allowed', email_count <= 10 and ip_count <= 30,
    'emailLocked', email_locked is not null and email_locked > now(),
    'ipLocked', ip_locked is not null and ip_locked > now(),
    'failedCount', greatest(coalesce((select failed_count from public.auth_login_failures where lower(identity)=lower(p_email)),0), coalesce((select failed_count from public.auth_login_failures where lower(identity)=lower('ip:' || coalesce(nullif(p_ip,''),'unknown'))),0))
  );
end; $$;

create or replace function public.fala_auth_finalize(p_email text, p_ip text, p_display_name text, p_token text, p_created_at timestamptz, p_expires_at timestamptz)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  account public.users%rowtype;
begin
  insert into public.users(email, display_name, created_at, last_seen_at, password_hash, consent_version, consented_at)
  values (lower(p_email), left(coalesce(nullif(p_display_name,''), split_part(lower(p_email),'@',1)),120), p_created_at, p_created_at, 'supabase', 'v1', p_created_at)
  on conflict(email) do update set last_seen_at = excluded.last_seen_at;
  select * into account from public.users where lower(email)=lower(p_email);
  if account.suspended_at is not null then
    return jsonb_build_object('ok', false, 'suspended', true);
  end if;
  delete from public.auth_sessions where lower(user_email)=lower(p_email);
  insert into public.auth_sessions(token,user_email,created_at,expires_at) values (p_token, lower(p_email), p_created_at, p_expires_at);
  delete from public.auth_login_failures where lower(identity) in (lower(p_email), lower('ip:' || coalesce(nullif(p_ip,''),'unknown')));
  return jsonb_build_object('ok', true, 'email', account.email, 'displayName', account.display_name);
end; $$;

revoke all on function public.fala_auth_preflight(text,text) from public, anon, authenticated;
revoke all on function public.fala_auth_finalize(text,text,text,text,timestamptz,timestamptz) from public, anon, authenticated;
grant execute on function public.fala_auth_preflight(text,text) to service_role;
grant execute on function public.fala_auth_finalize(text,text,text,text,timestamptz,timestamptz) to service_role;
