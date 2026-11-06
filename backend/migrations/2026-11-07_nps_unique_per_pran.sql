-- Allow more than one NPS account (e.g. Protean + CAMS PRANs) per statement month
ALTER TABLE nps_holdings ADD CONSTRAINT nps_holdings_user_pran_statement_key UNIQUE (user_id, pran, statement_to);
-- after the code using the new key is live:
ALTER TABLE nps_holdings DROP CONSTRAINT IF EXISTS nps_holdings_user_id_statement_to_key;
