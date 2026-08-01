-- Brute-force protection for the email login endpoint.
create table if not exists public.auth_login_failures (
  identity text primary key not null,
  failed_count integer not null default 0,
  first_failed_at timestamptz not null,
  locked_until timestamptz,
  updated_at timestamptz not null
);

revoke all on table public.auth_login_failures from public, anon, authenticated;
