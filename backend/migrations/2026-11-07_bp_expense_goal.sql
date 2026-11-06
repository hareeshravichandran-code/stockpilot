-- Set once Blueprint has created/adopted the "Monthly expenses" goal for a user
ALTER TABLE users ADD COLUMN IF NOT EXISTS bp_expense_goal BOOLEAN NOT NULL DEFAULT false;
