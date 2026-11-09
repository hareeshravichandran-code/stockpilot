-- SMS reading issues: one row per message format (sender + body with values blanked), samples and who saw it
create table if not exists sms_issues (
  id uuid primary key default gen_random_uuid(),
  fingerprint text not null unique,
  sender_code text,
  template text not null,
  sample text,
  kind text not null default 'missed',
  status text not null default 'pending' check (status in ('pending','included','ignored')),
  hits int not null default 0,
  users int not null default 0,
  amounts jsonb not null default '[]'::jsonb,
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  admin_note text,
  fixed_in text,
  reopened boolean not null default false,
  updated_at timestamptz not null default now()
);
create index if not exists sms_issues_status on sms_issues(status, last_seen desc);

create table if not exists sms_issue_samples (
  id bigserial primary key,
  issue_id uuid not null references sms_issues(id) on delete cascade,
  user_id uuid references users(id) on delete set null,
  body text not null,
  body_hash text not null,
  sender text,
  sms_at timestamptz,
  parsed jsonb,
  app_version text,
  created_at timestamptz not null default now(),
  unique (issue_id, body_hash)
);

create table if not exists sms_issue_users (
  issue_id uuid not null references sms_issues(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  primary key (issue_id, user_id)
);

alter table sms_issues enable row level security;
alter table sms_issue_samples enable row level security;
alter table sms_issue_users enable row level security;
