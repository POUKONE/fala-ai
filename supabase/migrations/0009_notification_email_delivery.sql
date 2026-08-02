-- Align the table created by early runtime deployments with the Postgres
-- schema so timestamp comparisons work consistently in the notification API.
alter table public.notification_events
  alter column due_at type timestamptz using due_at::timestamptz,
  alter column created_at type timestamptz using created_at::timestamptz,
  alter column read_at type timestamptz using read_at::timestamptz;

alter table public.notification_events
  add column if not exists email_sent_at timestamptz;

alter table public.notification_events
  alter column email_sent_at type timestamptz using email_sent_at::timestamptz;

create index if not exists notification_events_email_due_idx
  on public.notification_events(email_sent_at, due_at);
