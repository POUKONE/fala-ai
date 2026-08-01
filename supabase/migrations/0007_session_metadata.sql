-- Session inventory and inactivity expiry. Run after 0006.
alter table public.auth_sessions add column if not exists last_seen_at timestamptz not null default now();
alter table public.auth_sessions add column if not exists user_agent text;
alter table public.auth_sessions add column if not exists ip_address text;
create index if not exists auth_sessions_last_seen_idx on public.auth_sessions(user_email, last_seen_at);

drop function if exists public.fala_auth_finalize(text, text, text, text, timestamptz, timestamptz);
create function public.fala_auth_finalize(
  p_email text,
  p_ip text,
  p_display_name text,
  p_token text,
  p_created_at timestamptz,
  p_expires_at timestamptz,
  p_user_agent text default null
)
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
  insert into public.auth_sessions(token,user_email,created_at,expires_at,last_seen_at,user_agent,ip_address)
  values (p_token, lower(p_email), p_created_at, p_expires_at, p_created_at, left(p_user_agent,300), left(p_ip,120));
  delete from public.auth_login_failures where lower(identity) in (lower(p_email), lower('ip:' || coalesce(nullif(p_ip,''),'unknown')));
  return jsonb_build_object('ok', true, 'email', account.email, 'displayName', account.display_name);
end; $$;

revoke all on function public.fala_auth_finalize(text, text, text, text, timestamptz, timestamptz, text) from public, anon, authenticated;
grant execute on function public.fala_auth_finalize(text, text, text, text, timestamptz, timestamptz, text) to service_role;
