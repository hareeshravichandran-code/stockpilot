-- Phone "Ignore this SMS" rules have no category; they were never stored on the server.
alter table user_sms_rules add column if not exists is_ignored boolean not null default false;
alter table user_sms_rules alter column category_id drop not null;
alter table user_sms_rules add constraint user_sms_rules_cat_or_ignore check (category_id is not null or is_ignored);
