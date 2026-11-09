-- Private test account: one-click login link and resettable data
alter table users add column if not exists is_test boolean not null default false;
alter table users add column if not exists test_key_hash text;
