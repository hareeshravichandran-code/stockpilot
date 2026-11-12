-- SMS groups found by the phone during setup, sorted later on the web or in the app
create table if not exists public.sms_groups (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null, key text not null, pattern_tok text[], name text, sample text, sender_key text,
  count int not null default 0, total numeric, avg_amount numeric, min_amount numeric, max_amount numeric, first_seen date, last_seen date,
  cadence text, due_day smallint, suggested text, status text not null default 'open', category_id text, event_id uuid, rule_id uuid,
  source text default 'phone', created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique (owner_id, key));
alter table public.sms_groups enable row level security;
create index if not exists sms_groups_owner_idx on public.sms_groups(owner_id, status);
