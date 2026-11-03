-- Kanalyst Blueprint — lanes carry a time window. Additive only.
-- horizon: this_week | this_month | this_year | next_year | year_2 | year_3 | year_4 | year_5
--          | years_1_5 | years_2_5 | beyond_5 | custom (uses horizon_from / horizon_to)
ALTER TABLE bp_layers ADD COLUMN IF NOT EXISTS horizon TEXT;
ALTER TABLE bp_layers ADD COLUMN IF NOT EXISTS horizon_from DATE;
ALTER TABLE bp_layers ADD COLUMN IF NOT EXISTS horizon_to DATE;
-- Map lanes created before this change by their name
UPDATE bp_layers SET horizon = CASE
  WHEN lower(label) IN ('this week') THEN 'this_week'
  WHEN lower(label) IN ('this month') THEN 'this_month'
  WHEN lower(label) IN ('this year') THEN 'this_year'
  WHEN lower(label) IN ('next year') THEN 'next_year'
  WHEN label ~* '^1\s*[–-]\s*5' THEN 'years_1_5'
  WHEN label ~* '^5\+' THEN 'beyond_5'
  ELSE NULL END
WHERE horizon IS NULL;
