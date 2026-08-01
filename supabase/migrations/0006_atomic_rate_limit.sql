-- Atomic rate limiting for production authentication paths.
-- Run after 0005_auth_fast_path.sql in Supabase SQL Editor.
create or replace function public.fala_rate_limit_atomic(
  p_key text,
  p_limit integer,
  p_window_seconds integer default 900
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_window timestamptz;
  current_count integer;
  window_start_at timestamptz := now();
  normalized_key text := left(lower(trim(coalesce(p_key, ''))), 240);
begin
  if normalized_key = '' or p_limit < 1 or p_window_seconds < 1 then
    return jsonb_build_object('allowed', false, 'count', 0, 'limit', greatest(p_limit, 1));
  end if;

  -- The row lock taken by ON CONFLICT serializes concurrent requests for the
  -- same key, preventing two requests from both passing the last slot.
  insert into public.rate_limits(key, window_start, count)
  values (normalized_key, window_start_at, 1)
  on conflict (key) do update set
    window_start = case
      when public.rate_limits.window_start <= now() - make_interval(secs => p_window_seconds)
        then window_start_at
      else public.rate_limits.window_start
    end,
    count = case
      when public.rate_limits.window_start <= now() - make_interval(secs => p_window_seconds)
        then 1
      else public.rate_limits.count + 1
    end
  returning rate_limits.window_start, rate_limits.count into current_window, current_count;

  return jsonb_build_object(
    'allowed', current_count <= p_limit,
    'count', current_count,
    'limit', p_limit,
    'windowStart', current_window
  );
end;
$$;

-- Keep the public preflight API stable while moving its two counters to the
-- atomic primitive above.
create or replace function public.fala_auth_preflight(p_email text, p_ip text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  email_key text := lower(p_email) || ':auth-login';
  ip_key text := lower(coalesce(nullif(p_ip, ''), 'unknown')) || ':auth-login';
  email_result jsonb := public.fala_rate_limit_atomic(email_key, 10, 900);
  ip_result jsonb := public.fala_rate_limit_atomic(ip_key, 30, 900);
  email_locked timestamptz;
  ip_locked timestamptz;
begin
  select locked_until into email_locked from public.auth_login_failures where lower(identity) = lower(p_email);
  select locked_until into ip_locked from public.auth_login_failures where lower(identity) = lower('ip:' || coalesce(nullif(p_ip, ''), 'unknown'));
  return jsonb_build_object(
    'allowed', (email_result->>'allowed')::boolean and (ip_result->>'allowed')::boolean,
    'emailLocked', email_locked is not null and email_locked > now(),
    'ipLocked', ip_locked is not null and ip_locked > now(),
    'failedCount', greatest(
      coalesce((select failed_count from public.auth_login_failures where lower(identity)=lower(p_email)), 0),
      coalesce((select failed_count from public.auth_login_failures where lower(identity)=lower('ip:' || coalesce(nullif(p_ip,''),'unknown'))), 0)
    )
  );
end;
$$;

revoke all on function public.fala_rate_limit_atomic(text, integer, integer) from public, anon, authenticated;
revoke all on function public.fala_auth_preflight(text, text) from public, anon, authenticated;
grant execute on function public.fala_rate_limit_atomic(text, integer, integer) to service_role;
grant execute on function public.fala_auth_preflight(text, text) to service_role;
