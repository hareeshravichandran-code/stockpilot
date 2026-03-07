# 🚀 StockPilot — Deployment Guide
## Deploy a working website in ~45 minutes (no coding needed)

---

## What you're deploying
- **Frontend** (the website) → Vercel (free)
- **Backend** (the server) → Railway (free)
- **Database** → Supabase (free)
- **Email Auth** → Google Cloud Console (free)

---

## STEP 1 — Set up GitHub (5 min)

1. Go to https://github.com and create a free account
2. Click "New repository" → name it `stockpilot`
3. Make it **Private**
4. Click "Create repository"
5. Upload all the files I gave you:
   - Drag the `backend/` folder → GitHub
   - Drag the `frontend/` folder → GitHub
   - Drag `database-schema.sql` → GitHub
6. Click "Commit changes"

---

## STEP 2 — Set up Supabase Database (10 min)

1. Go to https://supabase.com → "Start your project" → Sign up free
2. Click "New Project"
   - Name: `stockpilot`
   - Password: make a strong one, **save it**
   - Region: **South Asia (Mumbai)**
3. Wait ~2 minutes for project to create
4. Click **SQL Editor** (left sidebar)
5. Open `database-schema.sql` from your files
6. Copy ALL the SQL and paste into the editor
7. Click **Run** — you should see "Success"
8. Now go to **Settings → API**
9. Copy and save these 3 things:
   - `Project URL` (looks like: https://abcxyz.supabase.co)
   - `anon public` key
   - `service_role` key (click "Reveal")

---

## STEP 3 — Set up Google OAuth for Gmail (10 min)

1. Go to https://console.cloud.google.com
2. Create a new project → name it `StockPilot`
3. Click **APIs & Services → Enable APIs**
   - Search "Gmail API" → Enable it
4. Click **APIs & Services → OAuth consent screen**
   - User Type: **External** → Create
   - App name: `StockPilot`
   - User support email: your email
   - Scroll down → Save and Continue (skip scopes for now)
   - Add your own email as a test user → Save
5. Click **APIs & Services → Credentials → Create Credentials → OAuth Client ID**
   - Application type: **Web application**
   - Name: `StockPilot Backend`
   - Authorized redirect URIs: `https://YOUR-RAILWAY-URL.railway.app/api/email/gmail/callback`
   - (You'll get the Railway URL in Step 4 — come back and add it)
   - Click Create
6. Save the **Client ID** and **Client Secret**

---

## STEP 4 — Deploy Backend to Railway (10 min)

1. Go to https://railway.app → Sign up with GitHub
2. Click **New Project → Deploy from GitHub repo**
3. Select your `stockpilot` repo
4. Click **Add service → GitHub repo** → select the `backend` folder
5. Once deployed, click your service → **Variables** tab
6. Add ALL these environment variables one by one:

```
SUPABASE_URL          = (your Supabase Project URL from Step 2)
SUPABASE_ANON_KEY     = (your Supabase anon key from Step 2)
SUPABASE_SERVICE_KEY  = (your Supabase service_role key from Step 2)
GOOGLE_CLIENT_ID      = (from Step 3)
GOOGLE_CLIENT_SECRET  = (from Step 3)
GOOGLE_REDIRECT_URI   = https://YOUR-RAILWAY-URL.railway.app/api/email/gmail/callback
JWT_SECRET            = stockpilot_super_secret_key_change_this_2025
FRONTEND_URL          = https://YOUR-VERCEL-URL.vercel.app
PORT                  = 4000
```

7. Click **Settings → Generate Domain** → copy your Railway URL
   - Example: `https://stockpilot-backend.up.railway.app`
8. Go BACK to Google Console (Step 3, step 5) and add:
   - Authorized redirect URI: `https://YOUR-RAILWAY-URL.railway.app/api/email/gmail/callback`
9. Update `GOOGLE_REDIRECT_URI` in Railway with this URL
10. Test: Visit `https://YOUR-RAILWAY-URL.railway.app/health` — should show `{"status":"ok"}`

---

## STEP 5 — Deploy Frontend to Vercel (5 min)

1. Go to https://vercel.com → Sign up with GitHub
2. Click **Add New → Project**
3. Import your `stockpilot` GitHub repo
4. Set **Root Directory** to `frontend`
5. Click **Environment Variables** and add:
```
REACT_APP_API_URL = https://YOUR-RAILWAY-URL.railway.app
```
6. Click **Deploy**
7. Wait ~2 minutes → you'll get a URL like `https://stockpilot.vercel.app`
8. **Go back to Railway** → update `FRONTEND_URL` with your Vercel URL
9. **Go back to Google Console** → add your Vercel URL to authorized JavaScript origins

---

## STEP 6 — Test Everything (5 min)

1. Visit your Vercel URL → you should see the StockPilot landing page
2. Click "Get Started Free" → create an account
3. You should reach the dashboard
4. Click "Connect Email" → Connect Gmail
5. Google login screen should appear
6. After connecting → click "Sync Emails"
7. It will scan your inbox and import trades/dividends!

---

## 🎉 You're live!

Share your Vercel URL with friends to let them sign up.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| Backend health check fails | Check Railway logs → Variables tab → make sure all env vars are set |
| Gmail OAuth error | Make sure GOOGLE_REDIRECT_URI exactly matches what's in Google Console |
| "Cannot connect to database" | Check SUPABASE_URL and SUPABASE_SERVICE_KEY are correct |
| Frontend shows blank page | Check browser console → REACT_APP_API_URL might be wrong |
| Emails not parsing | Gmail API might need app verification for production — use test users for now |

---

## Costs (Monthly)

| Service | Free Tier | Paid |
|---|---|---|
| Vercel | 100GB bandwidth | $0/month for small apps |
| Railway | $5 free credits/month | ~$5/month after |
| Supabase | 500MB DB, 50K users | $25/month after |
| Google APIs | 1B Gmail calls/month | Free |

**Total cost to run for first 500 users: ~₹0–400/month**

---

## Getting a custom domain (optional)

1. Buy `stockpilot.in` on GoDaddy (~₹800/year)
2. In Vercel → Settings → Domains → Add `stockpilot.in`
3. Follow DNS instructions → done in 24 hours

---

## Next Steps after going live

1. Share in Reddit r/IndiaInvestments
2. Post on Twitter/X with a demo video
3. Collect beta user feedback
4. Add Razorpay for payments (₹99/month plan)
5. Apply to be a Google OAuth verified app (for production users)
