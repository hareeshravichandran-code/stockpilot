-- Kanalyst — saved retirement plan + special goal kinds in Blueprint. Additive only.
-- data: { inputs, overrides, loans[], spend{}, sips{}, ... } written by the Retirement planner.
CREATE TABLE IF NOT EXISTS retirement_plans (
  user_id          UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  data             JSONB NOT NULL DEFAULT '{}'::jsonb,
  linked_bucket_id UUID REFERENCES bp_buckets(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ DEFAULT now(),
  updated_at       TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE retirement_plans ENABLE ROW LEVEL SECURITY;
-- special_kind: 'retirement' today; 'emi' | 'insurance' | 'fee' | 'emergency' later.
-- A special goal's target and date are owned by its module, not typed in Blueprint.
ALTER TABLE bp_buckets ADD COLUMN IF NOT EXISTS special_kind TEXT;
