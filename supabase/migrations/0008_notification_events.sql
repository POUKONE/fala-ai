-- Persistent, per-user notifications. The deterministic id makes reminder
-- creation idempotent when the workspace is opened or refreshed.
create table if not exists public.notification_events (
  id text primary key,
  user_email text not null references public.users(email) on delete cascade,
  application_id bigint not null references public.applications(id) on delete cascade,
  type text not null,
  due_at timestamptz not null,
  company text not null,
  role text not null,
  status text not null,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists notification_events_user_due_idx
  on public.notification_events(user_email, due_at);

revoke all on public.notification_events from anon, authenticated;
