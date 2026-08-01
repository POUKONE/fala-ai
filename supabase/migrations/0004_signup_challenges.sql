-- Keep incomplete registrations outside public.users. A user row is created
-- only after the address is verified and the password step succeeds.
create table if not exists public.signup_challenges (
  email text primary key,
  display_name text not null,
  code_hash text not null,
  expires_at timestamptz not null,
  attempts integer not null default 0,
  verified_at timestamptz,
  created_at timestamptz not null
);

revoke all on public.signup_challenges from anon, authenticated;
