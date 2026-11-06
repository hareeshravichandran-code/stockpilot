-- Alert level per event: very_high (EMI, card bill), high (insurance premium), medium (subscription...), low.
-- NULL = use the default for the event's kind. Manual events use master_table = 'manual'.
ALTER TABLE recurring_events ADD COLUMN IF NOT EXISTS alert_level TEXT;
ALTER TABLE recurring_events ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE insurance_policies ADD COLUMN IF NOT EXISTS alert_level TEXT;
ALTER TABLE recurring_events DROP CONSTRAINT IF EXISTS recurring_events_alert_level_check;
ALTER TABLE recurring_events ADD CONSTRAINT recurring_events_alert_level_check CHECK (alert_level IS NULL OR alert_level IN ('very_high','high','medium','low'));
ALTER TABLE insurance_policies DROP CONSTRAINT IF EXISTS insurance_policies_alert_level_check;
ALTER TABLE insurance_policies ADD CONSTRAINT insurance_policies_alert_level_check CHECK (alert_level IS NULL OR alert_level IN ('very_high','high','medium','low'));
