-- ═══════════════════════════════════════
-- StockPilot Database Schema
-- Run this in Supabase → SQL Editor
-- ═══════════════════════════════════════

-- Users table
CREATE TABLE IF NOT EXISTS users (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Email connections (Gmail, Outlook etc)
CREATE TABLE IF NOT EXISTS email_connections (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL, -- 'gmail' | 'outlook' | 'yahoo'
  access_token TEXT,
  refresh_token TEXT,
  expires_at TIMESTAMPTZ,
  connected_at TIMESTAMPTZ DEFAULT now(),
  last_synced TIMESTAMPTZ,
  emails_parsed INTEGER DEFAULT 0,
  UNIQUE(user_id, provider)
);

-- Holdings (current portfolio positions)
CREATE TABLE IF NOT EXISTS holdings (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  symbol TEXT NOT NULL,
  company TEXT,
  quantity INTEGER NOT NULL DEFAULT 0,
  avg_cost DECIMAL(12,4) NOT NULL DEFAULT 0,
  last_price DECIMAL(12,4),
  sector TEXT DEFAULT 'Other',
  dividend_per_share DECIMAL(10,4) DEFAULT 0,
  isin TEXT,
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, symbol)
);

-- Transactions (buy/sell from contract notes)
CREATE TABLE IF NOT EXISTS transactions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  email_id TEXT,
  type TEXT NOT NULL, -- 'BUY' | 'SELL'
  symbol TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  price DECIMAL(12,4) NOT NULL,
  broker TEXT,
  trade_date TIMESTAMPTZ,
  raw_subject TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(email_id, symbol, type)
);

-- Dividends (from dividend credit alerts)
CREATE TABLE IF NOT EXISTS dividends (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  email_id TEXT,
  company TEXT,
  symbol TEXT,
  dividend_per_share DECIMAL(10,4),
  quantity INTEGER,
  total_amount DECIMAL(12,2),
  credit_date TIMESTAMPTZ,
  source TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(email_id, company)
);

-- Row Level Security (RLS) — users can only see their own data
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE holdings ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE dividends ENABLE ROW LEVEL SECURITY;

-- RLS Policies (backend uses service key, so these mainly protect direct DB access)
CREATE POLICY "users_own" ON users FOR ALL USING (id = auth.uid());
CREATE POLICY "connections_own" ON email_connections FOR ALL USING (user_id = auth.uid());
CREATE POLICY "holdings_own" ON holdings FOR ALL USING (user_id = auth.uid());
CREATE POLICY "transactions_own" ON transactions FOR ALL USING (user_id = auth.uid());
CREATE POLICY "dividends_own" ON dividends FOR ALL USING (user_id = auth.uid());

-- Indexes for performance
CREATE INDEX idx_holdings_user ON holdings(user_id);
CREATE INDEX idx_transactions_user ON transactions(user_id);
CREATE INDEX idx_transactions_symbol ON transactions(user_id, symbol);
CREATE INDEX idx_dividends_user ON dividends(user_id);
CREATE INDEX idx_email_conn_user ON email_connections(user_id);
