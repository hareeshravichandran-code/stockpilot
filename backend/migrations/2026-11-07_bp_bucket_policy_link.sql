-- A Blueprint goal can belong to an insurance policy (its premium is the goal's recurring due).
ALTER TABLE bp_buckets ADD COLUMN IF NOT EXISTS policy_id UUID;
-- Set once Blueprint has linked or created a goal for the policy, so a goal the user deletes is not re-created.
ALTER TABLE insurance_policies ADD COLUMN IF NOT EXISTS bp_auto BOOLEAN NOT NULL DEFAULT false;
