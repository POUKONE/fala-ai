alter table public.notification_events
  add column if not exists email_sent_at timestamptz;

create index if not exists notification_events_email_due_idx
  on public.notification_events(email_sent_at, due_at);
