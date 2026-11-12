-- Rules are made once for each event that has none (from its master and earlier payments)
alter table public.recurring_events add column if not exists rules_seeded boolean not null default false;
