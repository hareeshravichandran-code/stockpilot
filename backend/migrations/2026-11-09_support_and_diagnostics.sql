-- Support chat (user <-> admin) and diagnostics uploads (logs, app data, masked SMS)
alter table users add column if not exists is_admin boolean not null default false;

create table if not exists diag_uploads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  app_version text,
  device jsonb,
  note text,
  sms_count int not null default 0,
  logs text,
  data jsonb,
  status text not null default 'new',
  admin_note text
);
create index if not exists diag_uploads_user on diag_uploads(user_id, created_at desc);

create table if not exists diag_sms (
  id bigserial primary key,
  upload_id uuid not null references diag_uploads(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  sender text,
  body text,
  sms_at timestamptz,
  financial boolean,
  parsed jsonb
);
create index if not exists diag_sms_upload on diag_sms(upload_id);

create table if not exists support_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  from_admin boolean not null default false,
  author_id uuid references users(id) on delete set null,
  body text,
  images text[] not null default '{}',
  diag_id uuid references diag_uploads(id) on delete set null,
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index if not exists support_messages_user on support_messages(user_id, created_at);

alter table diag_uploads enable row level security;
alter table diag_sms enable row level security;
alter table support_messages enable row level security;

insert into storage.buckets (id, name, public) values ('support', 'support', false) on conflict (id) do nothing;

update users set is_admin = true where email = 'hareeshravichandran@gmail.com';
