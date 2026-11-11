-- Recurring payments found in SMS that the user has reviewed (later / ignored / added as event or subscription)
create table if not exists public.recurring_reviews (
  owner_id uuid not null,
  fp text not null,
  status text not null check (status in ('later','ignored','added')),
  target_kind text,
  target_id text,
  seen_count int,
  reviewed_at timestamptz not null default now(),
  primary key (owner_id, fp)
);
alter table public.recurring_reviews enable row level security;
