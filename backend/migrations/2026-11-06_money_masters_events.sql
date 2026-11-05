-- Kanalyst Discover: money masters + events master. Additive only.
--
-- money_masters   One row per real-world thing found in SMS/email/PDF or added by hand:
--                 loan, card, bank_account, sip, subscription, income, rd (when the RD
--                 isn't complete enough for recurring_deposits). Insurance goes to the
--                 existing insurance_policies table; complete RDs to recurring_deposits.
--                 (owner_id, kind, inst_key, ref_key) is the natural key, so the same
--                 loan/card/folio is never created twice, whichever source sees it first.
-- recurring_events The events master used by the family calendar: one row per recurring
--                 obligation or inflow (EMI, SIP, card due, premium, subscription, RD
--                 instalment, salary, maturity). Linked to its master by (master_table, master_id).
-- event_payments  One row per occurrence that was seen paid (or missed), so the calendar
--                 can show paid / due / overdue without creating duplicate events.

CREATE TABLE IF NOT EXISTS money_masters (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('loan','card','bank_account','sip','subscription','income','rd')),
  institution TEXT,                       -- HDFC Bank, ICICI Prudential MF, Netflix, ACME Tech
  inst_key    TEXT NOT NULL DEFAULT '',   -- normalised institution, part of the natural key
  ref         TEXT,                       -- last 4 of loan/card/account, folio last 4
  ref_key     TEXT NOT NULL DEFAULT '',   -- normalised ref, part of the natural key
  title       TEXT NOT NULL,
  amount      NUMERIC(14,2),              -- EMI, SIP, subscription, salary, RD instalment
  frequency   TEXT NOT NULL DEFAULT 'monthly' CHECK (frequency IN ('monthly','quarterly','half_yearly','yearly','once','irregular')),
  due_day     SMALLINT CHECK (due_day BETWEEN 1 AND 31),
  due_month   SMALLINT CHECK (due_month BETWEEN 1 AND 12),
  start_date  DATE,                       -- first time it was seen
  end_date    DATE,
  category_id TEXT,                       -- expense category its money entries use
  linked_table TEXT,                      -- e.g. mf_holdings when a CAS folio matches
  linked_id   TEXT,
  meta        JSONB NOT NULL DEFAULT '{}',
  source      TEXT NOT NULL DEFAULT 'manual',   -- discover, manual, web, email, cas
  status      TEXT NOT NULL DEFAULT 'active',   -- active, closed
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS money_masters_natural_key ON money_masters(owner_id, kind, inst_key, ref_key);
CREATE INDEX IF NOT EXISTS money_masters_owner ON money_masters(owner_id);

CREATE TABLE IF NOT EXISTS recurring_events (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  master_table TEXT NOT NULL,             -- money_masters, insurance_policies, recurring_deposits
  master_id    TEXT NOT NULL,
  kind         TEXT NOT NULL,             -- emi, sip, card_due, premium, subscription, rd_instalment, salary, bill, maturity
  title        TEXT NOT NULL,
  amount       NUMERIC(14,2),
  frequency    TEXT NOT NULL DEFAULT 'monthly' CHECK (frequency IN ('monthly','quarterly','half_yearly','yearly','once')),
  due_day      SMALLINT CHECK (due_day BETWEEN 1 AND 31),
  due_month    SMALLINT CHECK (due_month BETWEEN 1 AND 12),
  start_date   DATE,
  end_date     DATE,
  remind_days  SMALLINT NOT NULL DEFAULT 3,
  member_id    UUID REFERENCES household_members(id) ON DELETE SET NULL,
  direction    TEXT NOT NULL DEFAULT 'out' CHECK (direction IN ('out','in')),
  source       TEXT NOT NULL DEFAULT 'manual',
  status       TEXT NOT NULL DEFAULT 'active',
  created_at   TIMESTAMPTZ DEFAULT now(),
  updated_at   TIMESTAMPTZ DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS recurring_events_master_kind ON recurring_events(owner_id, master_table, master_id, kind);
CREATE INDEX IF NOT EXISTS recurring_events_owner ON recurring_events(owner_id);

CREATE TABLE IF NOT EXISTS event_payments (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_id   UUID NOT NULL REFERENCES recurring_events(id) ON DELETE CASCADE,
  period     DATE NOT NULL,               -- the due date this payment settles
  status     TEXT NOT NULL DEFAULT 'paid' CHECK (status IN ('paid','missed','skipped')),
  amount     NUMERIC(14,2),
  paid_on    DATE,
  txn_ref    TEXT,                        -- expense_transactions.id or bank reference
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS event_payments_event_period ON event_payments(event_id, period);

ALTER TABLE money_masters    ENABLE ROW LEVEL SECURITY;
ALTER TABLE recurring_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_payments   ENABLE ROW LEVEL SECURITY;
