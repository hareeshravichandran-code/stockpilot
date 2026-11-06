-- Masters, phase 2: income/expense masters with types, SMS match rules, actual links,
-- and SMS samples users send to Kanalyst. Additive (the kind check is only widened).
--
-- Model: master (what it is) -> recurring_events (when it's expected) -> actual
-- (expense_transactions.master_id + event_payments). Once the actual for a period
-- arrives, the expected marker for that period is hidden in the calendar.

ALTER TABLE money_masters ADD COLUMN IF NOT EXISTS subtype TEXT;            -- income: salary, dividend, rental, interest, freelance, other
                                                                            -- expense: rent, school_fee, maid, utility, other
ALTER TABLE money_masters ADD COLUMN IF NOT EXISTS match JSONB NOT NULL DEFAULT '{}';
                                                                            -- {"keywords":["tenant name","upi id"], "any_amount":false, "sender":"HDFCBK"}
ALTER TABLE money_masters DROP CONSTRAINT IF EXISTS money_masters_kind_check;
ALTER TABLE money_masters ADD CONSTRAINT money_masters_kind_check
  CHECK (kind IN ('loan','card','bank_account','sip','subscription','income','expense','rd'));

-- The actual: which master a bank transaction belongs to (set by the matcher or by hand)
ALTER TABLE expense_transactions ADD COLUMN IF NOT EXISTS master_id UUID;
CREATE INDEX IF NOT EXISTS expense_transactions_master ON expense_transactions(master_id);

-- SMS the user chose to send to Kanalyst so the reader can learn new formats
CREATE TABLE IF NOT EXISTS sms_samples (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sender      TEXT,
  body_masked TEXT NOT NULL,                -- numbers masked on the phone before upload
  parsed      JSONB NOT NULL DEFAULT '{}',  -- what the app understood, if anything
  label       TEXT,                         -- what the user says it is
  note        TEXT,
  status      TEXT NOT NULL DEFAULT 'new',  -- new, reviewed, learned
  created_at  TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sms_samples_status ON sms_samples(status);
ALTER TABLE sms_samples ENABLE ROW LEVEL SECURITY;
