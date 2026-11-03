-- ════════════════════════════════════════════════════════════════════
--  Kanalyst Blueprint — visual goal planner
--  Run once in Supabase → SQL Editor. Additive only: no existing table
--  is altered, renamed or dropped.
-- ════════════════════════════════════════════════════════════════════

-- A "board" is the big box (e.g. "Family Plan 2026–2045")
CREATE TABLE IF NOT EXISTS bp_boards (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  description TEXT,
  color       TEXT DEFAULT 'lime',
  x           NUMERIC NOT NULL DEFAULT 80,
  y           NUMERIC NOT NULL DEFAULT 200,
  w           NUMERIC NOT NULL DEFAULT 900,
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

-- Horizontal bands inside a board — the time-horizon y-axis
-- period: week | month | year | multi_year
CREATE TABLE IF NOT EXISTS bp_layers (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  board_id    UUID NOT NULL REFERENCES bp_boards(id) ON DELETE CASCADE,
  label       TEXT NOT NULL,
  period      TEXT NOT NULL DEFAULT 'year',
  height      NUMERIC NOT NULL DEFAULT 150,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- Buckets: goals (inside a board/layer), external goals (board_id NULL),
-- and income sources (kind = 'income', always outside a board).
-- recurrence: none | weekly | monthly | yearly
-- status:     open | inprogress | completed
-- income_source: manual | income_category | dividends
CREATE TABLE IF NOT EXISTS bp_buckets (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  board_id        UUID REFERENCES bp_boards(id) ON DELETE CASCADE,
  layer_id        UUID REFERENCES bp_layers(id) ON DELETE SET NULL,
  kind            TEXT NOT NULL DEFAULT 'goal',
  name            TEXT NOT NULL,
  icon            TEXT,
  target_amount   NUMERIC DEFAULT 0,
  target_date     DATE,
  recurrence      TEXT NOT NULL DEFAULT 'none',
  cycle_start     DATE,
  status          TEXT NOT NULL DEFAULT 'open',
  completed_at    TIMESTAMPTZ,
  manual_value    NUMERIC DEFAULT 0,
  income_source   TEXT,
  income_category TEXT,
  expected_amount NUMERIC,
  x               NUMERIC NOT NULL DEFAULT 40,
  y               NUMERIC NOT NULL DEFAULT 40,
  w               NUMERIC NOT NULL DEFAULT 190,
  h               NUMERIC NOT NULL DEFAULT 96,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bp_buckets_user_idx ON bp_buckets(user_id);

-- Assets mapped into a bucket.
-- asset_type: stock | broker | mf | fd | rd | nps
-- asset_ref:  stock  → '<ISIN>|<demat_account>'
--             broker → '<demat_account>'   (whole broker/demat as one bucket)
--             mf     → '<folio_number>|<ISIN>'
--             fd/rd/nps → row id
-- RULE: a single asset can belong to only one bucket (enforced here).
-- Broker-vs-single-stock overlap is enforced in the API.
CREATE TABLE IF NOT EXISTS bp_bucket_assets (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  bucket_id   UUID NOT NULL REFERENCES bp_buckets(id) ON DELETE CASCADE,
  asset_type  TEXT NOT NULL,
  asset_ref   TEXT NOT NULL,
  asset_label TEXT,
  created_at  TIMESTAMPTZ DEFAULT now(),
  UNIQUE (user_id, asset_type, asset_ref)
);

-- Connections. Either to_bucket_id or to_board_id is set.
-- link_type: funds (income → goal/board) | backup (e.g. liquid → retirement) | related
CREATE TABLE IF NOT EXISTS bp_links (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  from_bucket_id  UUID NOT NULL REFERENCES bp_buckets(id) ON DELETE CASCADE,
  to_bucket_id    UUID REFERENCES bp_buckets(id) ON DELETE CASCADE,
  to_board_id     UUID REFERENCES bp_boards(id) ON DELETE CASCADE,
  link_type       TEXT NOT NULL DEFAULT 'related',
  label           TEXT,
  amount          NUMERIC,
  created_at      TIMESTAMPTZ DEFAULT now(),
  CHECK (to_bucket_id IS NOT NULL OR to_board_id IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS bp_comments (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  bucket_id   UUID NOT NULL REFERENCES bp_buckets(id) ON DELETE CASCADE,
  body        TEXT NOT NULL,
  is_system   BOOLEAN DEFAULT false,
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bp_attachments (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  bucket_id     UUID NOT NULL REFERENCES bp_buckets(id) ON DELETE CASCADE,
  file_name     TEXT NOT NULL,
  mime_type     TEXT,
  size_bytes    INTEGER,
  storage_path  TEXT NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT now()
);

-- Backend uses the service-role key, so RLS is enabled with no public
-- policies: tables are unreachable with the anon key.
ALTER TABLE bp_boards        ENABLE ROW LEVEL SECURITY;
ALTER TABLE bp_layers        ENABLE ROW LEVEL SECURITY;
ALTER TABLE bp_buckets       ENABLE ROW LEVEL SECURITY;
ALTER TABLE bp_bucket_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE bp_links         ENABLE ROW LEVEL SECURITY;
ALTER TABLE bp_comments      ENABLE ROW LEVEL SECURITY;
ALTER TABLE bp_attachments   ENABLE ROW LEVEL SECURITY;

-- Storage: attachments go to a PRIVATE bucket "blueprint-files".
-- The API creates it automatically on first upload; or create it in
-- Storage → New bucket → name "blueprint-files", Public OFF.
