-- Kanalyst Blueprint — goal colors and repeat schedule. Additive only.
-- recurrence_day:   weekly → 0-6 (Sun-Sat); monthly → 1-31 (day of month); yearly → 1-31
-- recurrence_month: yearly → 1-12
ALTER TABLE bp_buckets ADD COLUMN IF NOT EXISTS color TEXT;
ALTER TABLE bp_buckets ADD COLUMN IF NOT EXISTS recurrence_day INTEGER;
ALTER TABLE bp_buckets ADD COLUMN IF NOT EXISTS recurrence_month INTEGER;
