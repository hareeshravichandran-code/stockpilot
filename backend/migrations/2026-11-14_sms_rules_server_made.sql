-- Rules made on the server (events, SMS groups, web) get an id from the database,
-- and rules that match on sender + amount have no words.
alter table public.user_sms_rules alter column id set default gen_random_uuid()::text;
alter table public.user_sms_rules alter column merchant_pattern drop not null;
-- Events whose rule save failed before this fix get their rules made again
update public.recurring_events e set rules_seeded = false
 where rules_seeded and not exists (select 1 from public.user_sms_rules r where r.event_id = e.id and not r.is_deleted);
