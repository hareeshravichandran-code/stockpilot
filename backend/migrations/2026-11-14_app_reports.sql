-- Crash / error reports from the Android app (no user data: masked error text + code stack)
create table if not exists app_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete cascade,
  kind text not null default 'crash',
  app_version text, version_code int,
  screen text, error text, stack text,
  device text, os text,
  happened_at timestamptz, created_at timestamptz not null default now()
);
create index if not exists app_reports_created on app_reports (created_at desc);
alter table app_reports enable row level security;
