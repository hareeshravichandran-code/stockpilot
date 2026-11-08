-- First-time SMS setup + Blueprint special cards. Additive (kind check only widened).
ALTER TABLE money_masters DROP CONSTRAINT IF EXISTS money_masters_kind_check;
ALTER TABLE money_masters ADD CONSTRAINT money_masters_kind_check
  CHECK (kind IN ('loan','card','bank_account','sip','subscription','income','expense','rd','epf'));
-- A Blueprint card can belong to a master (salary, card, loan...) and carry its own settings (emergency fund: months x salary)
ALTER TABLE bp_buckets ADD COLUMN IF NOT EXISTS master_id UUID;
ALTER TABLE bp_buckets ADD COLUMN IF NOT EXISTS special_cfg JSONB NOT NULL DEFAULT '{}';
-- Which special cards Blueprint already created for a user (so a card the user deletes is not re-created)
ALTER TABLE users ADD COLUMN IF NOT EXISTS bp_special JSONB NOT NULL DEFAULT '{}';
-- When the user finished (or skipped) the first-time SMS setup
ALTER TABLE users ADD COLUMN IF NOT EXISTS sms_setup_at TIMESTAMPTZ;
