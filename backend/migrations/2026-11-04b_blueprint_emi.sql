-- Kanalyst Blueprint — EMI goals. Additive only.
-- An EMI goal (monthly) is linked to a loan goal outside the box; closing an
-- EMI cycle adds the paid amount to the loan goal.
ALTER TABLE bp_buckets ADD COLUMN IF NOT EXISTS is_emi BOOLEAN DEFAULT false;
ALTER TABLE bp_buckets ADD COLUMN IF NOT EXISTS is_loan BOOLEAN DEFAULT false;
ALTER TABLE bp_buckets ADD COLUMN IF NOT EXISTS emi_loan_id UUID REFERENCES bp_buckets(id) ON DELETE SET NULL;
