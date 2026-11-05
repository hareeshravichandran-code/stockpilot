-- Kanalyst Family OS: members, insurance, documents & renewals, custom calendar events.
-- Additive only. Each row belongs to the account that added it (owner_id);
-- people in the same family group can see each other's rows through the API.

CREATE TABLE IF NOT EXISTS household_members (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  relation        TEXT NOT NULL DEFAULT 'other',  -- self, spouse, child, parent, sibling, grandparent, in_law, other
  dob             DATE,
  color           TEXT,
  linked_user_id  UUID REFERENCES users(id) ON DELETE SET NULL,   -- has their own Kanalyst account
  notes           TEXT,
  sort_order      INT DEFAULT 0,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS household_members_owner ON household_members(owner_id);

CREATE TABLE IF NOT EXISTS insurance_policies (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind              TEXT NOT NULL DEFAULT 'health',  -- term, life, health, vehicle, home, accident, travel, other
  insurer           TEXT,
  plan_name         TEXT,
  policy_ref        TEXT,                            -- last 4 characters only
  sum_assured       NUMERIC(16,2),
  premium           NUMERIC(14,2),
  premium_frequency TEXT DEFAULT 'yearly',           -- monthly, quarterly, half_yearly, yearly, single
  start_date        DATE,
  renewal_date      DATE,                            -- next premium / renewal due
  end_date          DATE,                            -- cover ends / maturity
  member_ids        UUID[] DEFAULT '{}',             -- household_members covered
  nominee           TEXT,
  notes             TEXT,
  status            TEXT DEFAULT 'active',           -- active, lapsed, ended
  created_at        TIMESTAMPTZ DEFAULT now(),
  updated_at        TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS insurance_policies_owner ON insurance_policies(owner_id);

CREATE TABLE IF NOT EXISTS family_documents (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  member_id    UUID REFERENCES household_members(id) ON DELETE SET NULL,
  kind         TEXT NOT NULL DEFAULT 'other',  -- passport, driving_licence, pan, aadhaar, voter_id, vehicle_rc, puc, property_tax, school_fees, subscription, other
  title        TEXT NOT NULL,
  ref_last4    TEXT,                           -- last 4 characters only, never the full number
  issued_on    DATE,
  due_date     DATE,                           -- expiry or next due date
  repeat       TEXT DEFAULT 'none',            -- none, monthly, quarterly, half_yearly, yearly
  amount       NUMERIC(14,2),
  remind_days  INT DEFAULT 30,
  kept_at      TEXT,                           -- where the original is kept
  notes        TEXT,
  done         BOOLEAN DEFAULT false,
  created_at   TIMESTAMPTZ DEFAULT now(),
  updated_at   TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS family_documents_owner ON family_documents(owner_id);

CREATE TABLE IF NOT EXISTS family_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  member_id   UUID REFERENCES household_members(id) ON DELETE SET NULL,
  title       TEXT NOT NULL,
  date        DATE NOT NULL,
  repeat      TEXT DEFAULT 'none',             -- none, monthly, yearly
  kind        TEXT DEFAULT 'event',            -- event, anniversary, payment, reminder
  amount      NUMERIC(14,2),
  notes       TEXT,
  created_at  TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS family_events_owner ON family_events(owner_id);

ALTER TABLE household_members  ENABLE ROW LEVEL SECURITY;
ALTER TABLE insurance_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE family_documents   ENABLE ROW LEVEL SECURITY;
ALTER TABLE family_events      ENABLE ROW LEVEL SECURITY;
