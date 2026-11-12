-- Events + SMS rules model (additive)
alter table public.user_sms_rules add column if not exists is_deleted boolean not null default false, add column if not exists event_id uuid, add column if not exists sender_key text, add column if not exists amount_min numeric, add column if not exists amount_max numeric, add column if not exists source text default 'manual';
alter table public.recurring_events add column if not exists category_id text, add column if not exists buffer_days smallint not null default 2, add column if not exists pay_mode text not null default 'auto', add column if not exists amount_mode text not null default 'about';
alter table public.event_payments add column if not exists match_source text, add column if not exists timing text;
alter table public.expense_transactions add column if not exists event_id uuid;
create index if not exists user_sms_rules_event_idx on public.user_sms_rules(event_id);
create index if not exists expense_transactions_event_idx on public.expense_transactions(event_id);
-- labels for rules made from a payment; payments the user said are not an event
alter table public.user_sms_rules add column if not exists label text, add column if not exists sample_txn uuid;
alter table public.expense_transactions add column if not exists event_skip uuid[];
